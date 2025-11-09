package com.subtit.player.vpn;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import androidx.annotation.NonNull;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Handles routing table 1140 + ip rule configuration that mimics AdGuard's split routing. */
public final class PolicyRoutingController {

    private static final String TAG = "PolicyRoutingController";
    private static final String TABLE_ID = "1140";
    private static final String IPV4_ROUTES_ASSET = "vpn/routes_v4_table_1140.txt";
    private static final String IPV6_ROUTES_ASSET = "vpn/routes_v6_table_1140.txt";
    private static final String IPRULES_ASSET = "vpn/iprules_1140.txt";
    private static final String IP_BIN = "/system/bin/ip";
    private static final long COMMAND_TIMEOUT_MS = 3_000L;
    private static final int MAX_CAPTURED_OUTPUT = 512;
    private static final String PERMISSION_DENIED = "Permission denied";

    private final List<String> ipv4Routes;
    private final List<String> ipv6Routes;
    private final List<String> ipRules;
    private final boolean suAvailable;
    private volatile boolean fatalPermissionDenied = false;

    public PolicyRoutingController(@NonNull Context context) {
        AssetManager assets = context.getAssets();
        this.ipv4Routes = loadAssetLines(assets, IPV4_ROUTES_ASSET);
        this.ipv6Routes = loadAssetLines(assets, IPV6_ROUTES_ASSET);
        this.ipRules = loadAssetLines(assets, IPRULES_ASSET);
        this.suAvailable = detectSu();
        if (suAvailable) {
            Log.i(TAG, "Detected su binary; IP commands will run through su -c");
        }
        Log.i(TAG, "Loaded routing assets ipv4=" + ipv4Routes.size()
                + " ipv6=" + ipv6Routes.size()
                + " rules=" + ipRules.size());
    }

    public boolean apply(@NonNull String iface) {
        boolean success = true;
        success &= flushTable();
        success &= configureRoutes(iface);
        success &= configureRules();
        logCurrentState();
        return success;
    }

    public boolean clear() {
        boolean success = true;
        success &= runIpCommand("route", "flush", "table", TABLE_ID);
        success &= runIpCommand("rule", "flush", "table", TABLE_ID);
        return success;
    }

    private boolean flushTable() {
        boolean ok = runIpCommand("route", "flush", "table", TABLE_ID);
        ok &= runIpCommand("rule", "flush", "table", TABLE_ID);
        return ok;
    }

    private boolean configureRoutes(String iface) {
        if (fatalPermissionDenied) {
            return false;
        }
        boolean ok = true;
        for (String route : ipv4Routes) {
            if (!addRoute(false, route, iface)) {
                ok = false;
                if (fatalPermissionDenied) {
                    break;
                }
            }
        }
        for (String route : ipv6Routes) {
            if (!addRoute(true, route, iface)) {
                ok = false;
                if (fatalPermissionDenied) {
                    break;
                }
            }
        }
        return ok;
    }

    private boolean configureRules() {
        if (fatalPermissionDenied) {
            return false;
        }
        boolean ok = true;
        for (String rule : ipRules) {
            if (!installRule(rule)) {
                ok = false;
                if (fatalPermissionDenied) {
                    break;
                }
            }
        }
        return ok;
    }

    private boolean addRoute(boolean ipv6, String route, String iface) {
        if (route == null || route.isEmpty()) {
            return true;
        }
        List<String> params = new ArrayList<>();
        params.add("route");
        if (ipv6) {
            params.add("-6");
        }
        params.add("replace");
        params.add(route);
        params.add("dev");
        params.add(iface);
        params.add("table");
        params.add(TABLE_ID);
        return runIpCommand(params.toArray(new String[0]));
    }

    private boolean installRule(String ruleLine) {
        if (ruleLine == null || ruleLine.trim().isEmpty()) {
            return true;
        }
        String[] tokens = ruleLine.trim().split("\\s+");
        if (tokens.length == 0) {
            return true;
        }
        List<String> params = new ArrayList<>();
        params.add("rule");
        params.add("replace");
        Collections.addAll(params, tokens);
        return runIpCommand(params.toArray(new String[0]));
    }

    private boolean runIpCommand(String... args) {
        if (fatalPermissionDenied) {
            return false;
        }
        ProcessBuilder builder;
        List<String> command = new ArrayList<>();
        if (suAvailable) {
            builder = new ProcessBuilder("su", "-c", buildShellCommand(args));
            command.add("su");
            command.add("-c");
            command.add(buildShellCommand(args));
        } else {
            command.add(IP_BIN);
            command.addAll(Arrays.asList(args));
            builder = new ProcessBuilder(command);
        }
        Process process = null;
        try {
            process = builder.redirectErrorStream(true).start();
            String output = consumeStream(process.getInputStream());
            boolean finished = process.waitFor(COMMAND_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            if (!finished) {
                process.destroy();
                Log.w(TAG, "Command timed out " + command);
                return false;
            }
            int exitCode = process.exitValue();
            if (exitCode != 0) {
                Log.w(TAG, "Command failed " + command + " exit=" + exitCode
                        + " output=" + trimOutput(output));
                if (isPermissionDenied(exitCode, output)) {
                    fatalPermissionDenied = true;
                    Log.w(TAG, "Policy routing blocked by SELinux/CAP_NET_ADMIN. Further commands suppressed.");
                }
                return false;
            }
            return true;
        } catch (IOException | InterruptedException e) {
            Log.w(TAG, "Command error " + command, e);
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return false;
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private boolean detectSu() {
        Process process = null;
        try {
            process = new ProcessBuilder("su", "-c", "id")
                    .redirectErrorStream(true)
                    .start();
            boolean finished = process.waitFor(COMMAND_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            if (!finished) {
                process.destroy();
                return false;
            }
            return process.exitValue() == 0;
        } catch (Exception e) {
            return false;
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private boolean isPermissionDenied(int exitCode, @NonNull String output) {
        if (exitCode == 1 && output.contains(PERMISSION_DENIED)) {
            return true;
        }
        return output.contains("avc:  denied") || output.contains("not permitted");
    }

    private String buildShellCommand(String... args) {
        StringBuilder builder = new StringBuilder(IP_BIN);
        for (String arg : args) {
            builder.append(' ').append(arg);
        }
        return builder.toString();
    }

    private String consumeStream(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            if (builder.length() < MAX_CAPTURED_OUTPUT) {
                builder.append(line).append('\n');
            }
        }
        return builder.toString();
    }

    private String readIpCommand(String... args) {
        List<String> command = new ArrayList<>(args.length + 1);
        command.add(IP_BIN);
        command.addAll(Arrays.asList(args));
        Process process = null;
        try {
            process = new ProcessBuilder(command)
                    .redirectErrorStream(true)
                    .start();
            String output = consumeStream(process.getInputStream());
            boolean finished = process.waitFor(COMMAND_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            if (!finished) {
                process.destroy();
                return "";
            }
            int exitCode = process.exitValue();
            if (exitCode != 0) {
                Log.w(TAG, "read command failed " + command + " exit=" + exitCode);
                return "";
            }
            return output;
        } catch (IOException | InterruptedException e) {
            Log.w(TAG, "read command error " + command, e);
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return "";
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private void logCurrentState() {
        String routes = readIpCommand("route", "show", "table", TABLE_ID);
        if (!routes.isEmpty()) {
            Log.d(TAG, "table " + TABLE_ID + " routes:\n" + trimOutput(routes));
        }
        String rules = readIpCommand("rule", "show");
        if (!rules.isEmpty()) {
            Log.d(TAG, "ip rules:\n" + trimOutput(rules));
        }
    }

    private String trimOutput(String output) {
        if (output == null) {
            return "";
        }
        output = output.trim();
        if (output.length() <= MAX_CAPTURED_OUTPUT) {
            return output;
        }
        return output.substring(0, MAX_CAPTURED_OUTPUT) + "...";
    }

    @NonNull
    private List<String> loadAssetLines(@NonNull AssetManager assets, @NonNull String name) {
        List<String> lines = new ArrayList<>();
        try (InputStream stream = assets.open(name);
             BufferedReader reader = new BufferedReader(new InputStreamReader(stream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (!line.isEmpty()) {
                    lines.add(line);
                }
            }
        } catch (IOException e) {
            Log.w(TAG, "Unable to read asset " + name, e);
        }
        return lines;
    }

    public boolean hasFatalPermissionIssue() {
        return fatalPermissionDenied && !suAvailable;
    }
}

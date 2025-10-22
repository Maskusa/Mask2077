package com.subtit.player.plugins;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.TextToSpeech.Engine;
import android.speech.tts.TextToSpeech.EngineInfo;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.provider.Settings;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.lang.reflect.Method;

@CapacitorPlugin(name = "NativeTTS")
public class NativeTTSPlugin extends Plugin implements TextToSpeech.OnInitListener {
    private TextToSpeech textToSpeech;
    private boolean ready = false;
    private String activeEngine = null;
    private final List<String> logs = new ArrayList<>();
    private float currentPitch = 1f;
    private float currentRate = 1f;
    private static final int MAX_LOG_SIZE = 500;

    @Override
    public void load() {
        super.load();
        initializeTextToSpeech(null);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (textToSpeech != null) {
            log("TTS shutdown");
            textToSpeech.stop();
            textToSpeech.shutdown();
        }
    }

    private void initializeTextToSpeech(@Nullable String engineId) {
        ready = false;
        if (textToSpeech != null) {
            try {
                textToSpeech.stop();
                textToSpeech.shutdown();
            } catch (Exception ignored) {
                // ignore
            }
        }

        if (engineId != null && !engineId.isEmpty() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            log("Initializing TTS with engine: " + engineId);
            textToSpeech = new TextToSpeech(getContext(), this, engineId);
            activeEngine = engineId;
        } else {
            log("Initializing TTS with default engine");
            textToSpeech = new TextToSpeech(getContext(), this);
            activeEngine = null;
        }

        if (textToSpeech != null) {
            textToSpeech.setPitch(currentPitch);
            textToSpeech.setSpeechRate(currentRate);
            textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {
                    notifyState("start");
                }

                @Override
                public void onDone(String utteranceId) {
                    notifyState("done");
                }

                @Override
                public void onError(String utteranceId) {
                    notifyState("error");
                }
            });
        }
    }

    @Override
    public void onInit(int status) {
        ready = status == TextToSpeech.SUCCESS;
        log("TTS init status: " + (ready ? "SUCCESS" : "ERROR"));
        if (ready) {
            updateActiveEngine();
            Locale locale = textToSpeech.getLanguage();
            log("Active engine: " + getCurrentEngine());
            log("Active locale: " + (locale != null ? locale.toLanguageTag() : "default"));
        }
    }

    private void notifyState(@NonNull String state) {
        JSObject data = new JSObject();
        data.put("state", state);
        if (bridge != null) {
            bridge.executeOnMainThread(() -> notifyListeners("ttsState", data));
        } else {
            notifyListeners("ttsState", data);
        }
        log("State: " + state);
    }

    private void log(String message) {
        synchronized (logs) {
            if (logs.size() >= MAX_LOG_SIZE) {
                logs.remove(0);
            }
            logs.add(message);
        }
        final JSObject payload = new JSObject();
        payload.put("message", message);
        if (bridge != null) {
            bridge.executeOnMainThread(() -> notifyListeners("log", payload));
        } else {
            notifyListeners("log", payload);
        }
    }

    private void updateActiveEngine() {
        if (textToSpeech == null) {
            log("updateActiveEngine skipped (tts=null)");
            return;
        }
        log("updateActiveEngine start. activeEngine=" + activeEngine);
        String current = queryCurrentEngine();
        if (current != null && !current.isEmpty()) {
            log("updateActiveEngine detected current=" + current);
            activeEngine = current;
            return;
        }
        activeEngine = textToSpeech.getDefaultEngine();
        log("updateActiveEngine fallback default=" + activeEngine);
    }

    private String getCurrentEngine() {
        if (activeEngine != null) {
            log("getCurrentEngine returning cached=" + activeEngine);
            return activeEngine;
        }
        if (textToSpeech == null) {
            log("getCurrentEngine returning null (tts=null)");
            return null;
        }
        String current = queryCurrentEngine();
        if (current != null && !current.isEmpty()) {
            log("getCurrentEngine returning queried=" + current);
            return current;
        }
        String fallback = textToSpeech.getDefaultEngine();
        log("getCurrentEngine fallback default=" + fallback);
        return fallback;
    }

    @Nullable
    private String queryCurrentEngine() {
        if (textToSpeech == null) {
            return null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.ICE_CREAM_SANDWICH_MR1) {
            try {
                Method method = TextToSpeech.class.getDeclaredMethod("getCurrentEngine");
                method.setAccessible(true);
                Object value = method.invoke(textToSpeech);
                if (value instanceof String) {
                    log("queryCurrentEngine reflection result=" + value);
                    return (String) value;
                }
            } catch (Exception ignored) {
                log("queryCurrentEngine reflection failed: " + ignored.getClass().getSimpleName());
                // fall through to other strategies
            }
        }
        try {
            String secureValue = Settings.Secure.getString(
                    getContext().getContentResolver(),
                    "tts_default_synth"
            );
            log("queryCurrentEngine secure setting=" + secureValue);
            return secureValue;
        } catch (Exception ignored) {
            log("queryCurrentEngine secure setting failed: " + ignored.getClass().getSimpleName());
            return null;
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", ready);
        call.resolve(result);
    }

    @PluginMethod
    public void getEngines(PluginCall call) {
        log("getEngines invoked");
        JSArray enginesArray = new JSArray();
        List<EngineInfo> engines = textToSpeech != null ? textToSpeech.getEngines() : new ArrayList<>();
        List<String> engineNames = new ArrayList<>();
        if (engines != null) {
            for (EngineInfo engine : engines) {
                JSObject engineObj = new JSObject();
                engineObj.put("id", engine.name);
                engineObj.put("label", engine.label != null ? engine.label : engine.name);
                enginesArray.put(engineObj);
                engineNames.add(engine.name);
            }
        }
        log("Requested engines. count=" + enginesArray.length() + " names=" + engineNames);
        JSObject payload = new JSObject();
        payload.put("engines", enginesArray);
        payload.put("currentEngine", getCurrentEngine());
        log("getEngines resolving current=" + payload.getString("currentEngine"));
        call.resolve(payload);
    }

    @PluginMethod
    public void selectEngine(PluginCall call) {
        String engineId = call.getString("engineId");
        if (engineId == null || engineId.trim().isEmpty()) {
            call.reject("engineId is required");
            return;
        }
        log("Engine selection requested: " + engineId);
        initializeTextToSpeech(engineId);
        updateActiveEngine();
        log("Engine selection applied. activeEngine=" + activeEngine + " queried=" + getCurrentEngine());
        JSObject result = new JSObject();
        result.put("engineId", engineId);
        call.resolve(result);
    }

    @PluginMethod
    public void getAvailableLanguages(PluginCall call) {
        JSArray languages = new JSArray();
        Locale defaultLocale = Locale.getDefault();
        if (textToSpeech != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    Set<Locale> available = textToSpeech.getAvailableLanguages();
                    if (available != null) {
                        for (Locale locale : available) {
                            if (locale != null) {
                                languages.put(locale.toLanguageTag());
                            }
                        }
                    }
                } catch (Exception ex) {
                    log("getAvailableLanguages failed: " + ex.getMessage());
                }
            }
            Locale current = textToSpeech.getLanguage();
            if (current != null) {
                languages.put(current.toLanguageTag());
            }
        }
        languages.put(defaultLocale.toLanguageTag());
        JSObject payload = new JSObject();
        payload.put("languages", languages);
        payload.put("defaultLanguage", defaultLocale.toLanguageTag());
        call.resolve(payload);
    }

    @PluginMethod
    public void getVoices(PluginCall call) {
        log("getVoices invoked ready=" + ready + " tts=" + (textToSpeech != null));
        if (!ready || textToSpeech == null) {
            log("getVoices requested before engine ready");
            call.reject("not_ready");
            return;
        }
        JSObject result = new JSObject();
        JSArray voicesArray = new JSArray();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Set<Voice> voices = textToSpeech.getVoices();
            if (voices != null) {
                for (Voice voice : voices) {
                    JSObject voiceObject = new JSObject();
                    voiceObject.put("id", voice.getName());
                    voiceObject.put("name", voice.getName());
                    Locale locale = voice.getLocale() != null ? voice.getLocale() : textToSpeech.getLanguage();
                    voiceObject.put("locale", locale != null ? locale.toLanguageTag() : Locale.getDefault().toLanguageTag());
                    voiceObject.put("quality", voice.getQuality());
                    voiceObject.put("latency", voice.getLatency());
                    voicesArray.put(voiceObject);
                }
            }
        }
        if (voicesArray.length() == 0) {
            JSObject defaultVoice = new JSObject();
            Locale locale = textToSpeech.getLanguage() != null ? textToSpeech.getLanguage() : Locale.getDefault();
            defaultVoice.put("id", locale.toLanguageTag());
            defaultVoice.put("name", locale.getDisplayName());
            defaultVoice.put("locale", locale.toLanguageTag());
            voicesArray.put(defaultVoice);
        }
        log("Voices returned. count=" + voicesArray.length());
        result.put("voices", voicesArray);
        call.resolve(result);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        String voiceId = call.getString("voiceId");
        Double rate = call.getDouble("rate", (double) currentRate);
        Double pitch = call.getDouble("pitch", (double) currentPitch);

        if (text == null || text.trim().isEmpty()) {
            call.reject("Text is required");
            return;
        }
        if (!ready) {
            call.reject("TextToSpeech engine not ready");
            return;
        }

        float targetRate = rate != null ? rate.floatValue() : currentRate;
        float targetPitch = pitch != null ? pitch.floatValue() : currentPitch;
        currentRate = targetRate;
        currentPitch = targetPitch;

        log("Speak request. chars=" + text.length() + " rate=" + targetRate + " pitch=" + targetPitch + " voice=" + voiceId);

        applyVoice(voiceId);
        textToSpeech.setSpeechRate(targetRate);
        textToSpeech.setPitch(targetPitch);
        String utteranceId = UUID.randomUUID().toString();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        } else {
            textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null);
        }

        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }

    private void applyVoice(@Nullable String voiceId) {
        if (voiceId == null || voiceId.isEmpty()) {
            return;
        }
        log("Applying voice: " + voiceId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Set<Voice> voices = textToSpeech.getVoices();
            if (voices != null) {
                for (Voice voice : voices) {
                    if (voice.getName().equalsIgnoreCase(voiceId)) {
                        textToSpeech.setVoice(voice);
                        return;
                    }
                }
            }
        } else {
            Locale locale = Locale.forLanguageTag(voiceId);
            textToSpeech.setLanguage(locale);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (textToSpeech != null) {
            boolean wasSpeaking = textToSpeech.isSpeaking();
            log("Stop requested");
            textToSpeech.stop();
            if (wasSpeaking) {
                notifyState("done");
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void setPitch(PluginCall call) {
        Double pitch = call.getDouble("pitch");
        if (pitch == null) {
            call.reject("pitch is required");
            return;
        }
        currentPitch = pitch.floatValue();
        if (textToSpeech != null) {
            textToSpeech.setPitch(currentPitch);
        }
        log("Pitch updated: " + currentPitch);
        call.resolve();
    }

    @PluginMethod
    public void setSpeechRate(PluginCall call) {
        Double rate = call.getDouble("rate");
        if (rate == null) {
            call.reject("rate is required");
            return;
        }
        currentRate = rate.floatValue();
        if (textToSpeech != null) {
            textToSpeech.setSpeechRate(currentRate);
        }
        log("Speech rate updated: " + currentRate);
        call.resolve();
    }

    @PluginMethod
    public void synthesizeToFile(PluginCall call) {
        String text = call.getString("text");
        String voiceId = call.getString("voiceId");
        Double rate = call.getDouble("rate", (double) currentRate);
        Double pitch = call.getDouble("pitch", (double) currentPitch);
        if (text == null || text.trim().isEmpty()) {
            call.reject("Text is required");
            return;
        }
        if (!ready) {
            call.reject("TextToSpeech engine not ready");
            return;
        }

        float targetRate = rate != null ? rate.floatValue() : currentRate;
        float targetPitch = pitch != null ? pitch.floatValue() : currentPitch;
        currentRate = targetRate;
        currentPitch = targetPitch;

        log("Synthesize request. chars=" + text.length() + " rate=" + targetRate + " pitch=" + targetPitch + " voice=" + voiceId);

        applyVoice(voiceId);
        textToSpeech.setSpeechRate(targetRate);
        textToSpeech.setPitch(targetPitch);

        File outputFile = new File(getContext().getCacheDir(), "tts-" + System.currentTimeMillis() + ".wav");
        int status;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Bundle params = new Bundle();
            String utteranceId = UUID.randomUUID().toString();
            params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);
            status = textToSpeech.synthesizeToFile(text, params, outputFile, utteranceId);
        } else {
            status = textToSpeech.synthesizeToFile(text, null, outputFile.getAbsolutePath());
        }

        if (status != TextToSpeech.SUCCESS) {
            log("synthesizeToFile failed with status " + status);
            call.reject("Synthesize failed with status: " + status);
            return;
        }

        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", outputFile);
        JSObject result = new JSObject();
        result.put("uri", uri.toString());
        result.put("path", outputFile.getAbsolutePath());
        log("Audio synthesized: " + outputFile.getName());
        call.resolve(result);
    }

    @PluginMethod
    public void shareAudio(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null || uriString.trim().isEmpty()) {
            call.reject("uri is required");
            return;
        }
        try {
            Uri uri = Uri.parse(uriString);
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("audio/wav");
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(shareIntent, "Share audio");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            log("Share intent started for uri=" + uriString);
            call.resolve();
        } catch (Exception ex) {
            log("Share failed: " + ex.getMessage());
            call.reject("Share failed: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent[] candidates = new Intent[]{
                new Intent("com.android.settings.TTS_SETTINGS"),
                new Intent(android.provider.Settings.ACTION_VOICE_INPUT_SETTINGS),
                new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS),
                new Intent(Engine.ACTION_CHECK_TTS_DATA),
                new Intent(Engine.ACTION_INSTALL_TTS_DATA)
        };
        boolean launched = false;
        for (Intent candidate : candidates) {
            try {
                candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(candidate);
                log("Opened TTS settings via: " + candidate.getAction());
                launched = true;
                break;
            } catch (Exception ignored) {
                // try next candidate
            }
        }
        if (!launched) {
            String message = "Unable to open any TTS settings screen";
            log(message);
            call.reject(message);
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void getLogs(PluginCall call) {
        JSArray array = new JSArray();
        synchronized (logs) {
            for (String entry : logs) {
                array.put(entry);
            }
        }
        JSObject result = new JSObject();
        result.put("logs", array);
        call.resolve(result);
    }

    @PluginMethod
    public void clearLogs(PluginCall call) {
        synchronized (logs) {
            logs.clear();
        }
        log("Logs cleared");
        call.resolve();
    }
}


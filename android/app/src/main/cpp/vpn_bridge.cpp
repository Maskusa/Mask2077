#include <android/log.h>
#include <jni.h>
#include <android/log.h>

#include <chrono>
#include <cstdint>
#include <exception>
#include <mutex>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <utility>

#include <unistd.h>

extern "C" unsigned int lwip_port_rand(void) {
    static std::mutex rngMutex;
    static std::mt19937 rng([] {
        std::random_device rd;
        return rd();
    }());

    std::lock_guard<std::mutex> lock(rngMutex);
    return rng();
}

#include "hev-socks5-tunnel.h"

#define LOG_TAG "vpnbridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

enum class ProxyMode {
    HTTP = 0,
    SOCKS5 = 1,
};

struct TunnelState {
    std::mutex mutex;
    std::thread worker;
    bool running = false;
    int tunFd = -1;
    std::string lastError;
    std::chrono::steady_clock::time_point startedSteady{};
    int64_t startedWallMs = 0;
    int lastExitCode = 0;
};

TunnelState& state() {
    static TunnelState s;
    return s;
}

std::string escapeYaml(const std::string& value) {
    if (value.empty()) {
        return {};
    }
    std::string escaped;
    escaped.reserve(value.size());
    for (char c : value) {
        if (c == '\'') {
            escaped.push_back('\'');
        }
        escaped.push_back(c);
    }
    return escaped;
}

std::string buildYamlConfig(const std::string& host,
                            int port,
                            const std::string& username,
                            const std::string& password,
                            bool enableUdp) {
    constexpr int kMtu = 1500;
    const std::string udpMode = enableUdp ? "udp" : "tcp";

    std::ostringstream oss;
    oss << "tunnel:\n"
        << "  name: tun0\n"
        << "  mtu: " << kMtu << "\n"
        << "  multi-queue: false\n"
        << "  ipv4: 10.8.0.2\n"
        << "  ipv6: '::'\n"
        << "socks5:\n"
        << "  address: '" << escapeYaml(host) << "'\n"
        << "  port: " << port << "\n"
        << "  udp: '" << udpMode << "'\n";
    if (!username.empty()) {
        oss << "  username: '" << escapeYaml(username) << "'\n";
    }
    if (!password.empty()) {
        oss << "  password: '" << escapeYaml(password) << "'\n";
    }
    oss << "misc:\n"
        << "  log-level: info\n"
        << "  connect-timeout: 10000\n"
        << "  tcp-read-write-timeout: 300000\n"
        << "  udp-read-write-timeout: 60000\n";
    return oss.str();
}

std::string toStdString(JNIEnv* env, jstring value) {
    if (!value) {
        return {};
    }
    const char* utf = env->GetStringUTFChars(value, nullptr);
    if (!utf) {
        return {};
    }
    std::string out(utf);
    env->ReleaseStringUTFChars(value, utf);
    return out;
}

void joinWorkerLocked(TunnelState& s) {
    std::thread worker;
    {
        std::lock_guard<std::mutex> lock(s.mutex);
        if (!s.worker.joinable()) {
            return;
        }
        worker = std::move(s.worker);
        s.worker = std::thread();
    }
    if (worker.joinable()) {
        try {
            worker.join();
        } catch (const std::exception& ex) {
            LOGW("Worker join raised exception: %s", ex.what());
        }
    }
}

void setErrorState(const std::string& message, int code) {
    TunnelState& s = state();
    std::lock_guard<std::mutex> lock(s.mutex);
    s.lastError = message;
    s.lastExitCode = code;
}

void resetErrorState() {
    TunnelState& s = state();
    std::lock_guard<std::mutex> lock(s.mutex);
    s.lastError.clear();
    s.lastExitCode = 0;
}

}  // namespace

extern "C"
JNIEXPORT void JNICALL
Java_com_subtit_player_vpn_Tun2SocksBridge_nativeInit(JNIEnv*, jclass) {
    LOGI("nativeInit completed");
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_com_subtit_player_vpn_Tun2SocksBridge_nativeStart(JNIEnv* env,
                                                       jclass,
                                                       jint tunFd,
                                                       jstring jHost,
                                                       jint jPort,
                                                       jint modeOrdinal,
                                                       jstring jUser,
                                                       jstring jPass,
                                                       jboolean enableUdp) {
    auto mode = static_cast<ProxyMode>(modeOrdinal);
    resetErrorState();
    std::string host = toStdString(env, jHost);
    if (host.empty()) {
        LOGE("Proxy host is empty");
        setErrorState("Empty proxy host", -1);
        return JNI_FALSE;
    }
    if (tunFd < 0) {
        LOGE("Invalid tun fd: %d", tunFd);
        setErrorState("Invalid TUN descriptor", -2);
        return JNI_FALSE;
    }

    std::string username = toStdString(env, jUser);
    std::string password = toStdString(env, jPass);
    std::string config = buildYamlConfig(host, jPort, username, password, enableUdp);

    int duplicatedFd = ::dup(tunFd);
    if (duplicatedFd < 0) {
        LOGE("Failed to dup tun fd");
        setErrorState("dup() on TUN failed", -3);
        return JNI_FALSE;
    }

    TunnelState& s = state();
    joinWorkerLocked(s);
    std::lock_guard<std::mutex> lock(s.mutex);

    if (s.running) {
        LOGW("Tunnel already running");
        ::close(duplicatedFd);
        return JNI_FALSE;
    }

    s.lastError.clear();
    s.lastExitCode = 0;
    s.tunFd = duplicatedFd;
    s.running = true;
    s.startedSteady = std::chrono::steady_clock::now();
    s.startedWallMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                              std::chrono::system_clock::now().time_since_epoch())
                              .count();

    try {
        s.worker = std::thread([config, duplicatedFd]() {
            LOGI("Launching hev-socks5-tunnel worker");
            const auto* data =
                    reinterpret_cast<const unsigned char*>(config.c_str());
            unsigned int length = static_cast<unsigned int>(config.size());
            int rc = hev_socks5_tunnel_main_from_str(data, length, duplicatedFd);
            if (rc != 0) {
                LOGE("hev_socks5_tunnel_main_from_str exited with %d", rc);
            } else {
            LOGI("hev_socks5_tunnel_main_from_str exited cleanly");
        }
        ::close(duplicatedFd);

        TunnelState& localState = state();
        std::lock_guard<std::mutex> innerLock(localState.mutex);
        localState.tunFd = -1;
        localState.running = false;
        localState.startedSteady = {};
        localState.startedWallMs = 0;
        localState.lastExitCode = rc;
        if (rc != 0) {
            if (localState.lastError.empty()) {
                localState.lastError = "hev_socks5_tunnel_main_from_str exited with code " + std::to_string(rc);
            }
        } else {
            localState.lastError.clear();
        }
    });
    } catch (const std::exception& ex) {
        LOGE("Failed to start worker thread: %s", ex.what());
        ::close(duplicatedFd);
        s.running = false;
        s.tunFd = -1;
        s.startedSteady = {};
        s.startedWallMs = 0;
        s.lastExitCode = -4;
        s.lastError = ex.what();
        return JNI_FALSE;
    }

    return JNI_TRUE;
}

extern "C"
JNIEXPORT void JNICALL
Java_com_subtit_player_vpn_Tun2SocksBridge_nativeStop(JNIEnv*, jclass) {
    TunnelState& s = state();
    std::thread worker;
    {
        std::lock_guard<std::mutex> lock(s.mutex);
        if (!s.running && !s.worker.joinable()) {
            LOGI("Tunnel already stopped");
            return;
        }
        LOGI("Stopping hev-socks5-tunnel");
        hev_socks5_tunnel_quit();
        worker = std::move(s.worker);
        s.worker = std::thread();
    }
    if (worker.joinable()) {
        try {
            worker.join();
        } catch (const std::exception& ex) {
            LOGW("Worker join raised exception: %s", ex.what());
        }
    }
    std::lock_guard<std::mutex> lock(s.mutex);
    s.running = false;
    s.tunFd = -1;
    s.startedSteady = {};
    s.startedWallMs = 0;
    s.lastExitCode = 0;
    s.lastError.clear();
    if (s.worker.joinable()) {
        // Should not normally happen, but ensure thread is reset.
        s.worker = std::thread();
    }
}

extern "C"
JNIEXPORT jlongArray JNICALL
Java_com_subtit_player_vpn_Tun2SocksBridge_nativeGetStats(JNIEnv* env, jclass) {
    TunnelState& s = state();
    bool running;
    std::chrono::steady_clock::time_point startedSteady;
    int64_t startedWallMs;
    int exitCode;
    {
        std::lock_guard<std::mutex> lock(s.mutex);
        running = s.running;
        startedSteady = s.startedSteady;
        startedWallMs = s.startedWallMs;
        exitCode = s.lastExitCode;
    }

    size_t txPackets = 0;
    size_t txBytes = 0;
    size_t rxPackets = 0;
    size_t rxBytes = 0;
    if (running) {
        hev_socks5_tunnel_stats(&txPackets, &txBytes, &rxPackets, &rxBytes);
    }

    jlongArray result = env->NewLongArray(8);
    if (!result) {
        return nullptr;
    }
    const long long uptimeMs = (running && startedSteady != std::chrono::steady_clock::time_point())
            ? std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - startedSteady)
                      .count()
            : 0LL;
    jlong values[8];
    values[0] = static_cast<jlong>(txPackets);
    values[1] = static_cast<jlong>(txBytes);
    values[2] = static_cast<jlong>(rxPackets);
    values[3] = static_cast<jlong>(rxBytes);
    values[4] = static_cast<jlong>(running ? uptimeMs : 0LL);
    values[5] = static_cast<jlong>(running ? startedWallMs : 0LL);
    values[6] = running ? 1 : 0;
    values[7] = static_cast<jlong>(exitCode);
    env->SetLongArrayRegion(result, 0, 8, values);
    return result;
}

extern "C"
JNIEXPORT jint JNICALL
Java_com_subtit_player_vpn_Tun2SocksBridge_nativeGetExitCode(JNIEnv*, jclass) {
    TunnelState& s = state();
    std::lock_guard<std::mutex> lock(s.mutex);
    return s.lastExitCode;
}

extern "C"
JNIEXPORT jstring JNICALL
Java_com_subtit_player_vpn_Tun2SocksBridge_nativeGetLastError(JNIEnv* env, jclass) {
    TunnelState& s = state();
    std::lock_guard<std::mutex> lock(s.mutex);
    if (s.lastError.empty()) {
        return nullptr;
    }
    return env->NewStringUTF(s.lastError.c_str());
}

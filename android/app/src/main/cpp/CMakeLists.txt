cmake_minimum_required(VERSION 3.22.1)
project(vpnbridge LANGUAGES C CXX ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(COMMON_COMPILE_FLAGS "-Oz" "-ffunction-sections" "-fdata-sections")
add_compile_options(
        "$<$<COMPILE_LANGUAGE:C>:${COMMON_COMPILE_FLAGS}>"
        "$<$<COMPILE_LANGUAGE:CXX>:${COMMON_COMPILE_FLAGS}>"
)
string(APPEND CMAKE_SHARED_LINKER_FLAGS " -Wl,--gc-sections")

set(HEV_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/hev-socks5-tunnel)
set(HEV_THIRD_PARTY ${HEV_ROOT}/third-part)

# yaml static library
file(GLOB_RECURSE YAML_SOURCES CONFIGURE_DEPENDS
        ${HEV_THIRD_PARTY}/yaml/src/*.c
)
add_library(vendor_yaml STATIC ${YAML_SOURCES})
target_include_directories(vendor_yaml PUBLIC
        ${HEV_THIRD_PARTY}/yaml/include
)
target_compile_definitions(vendor_yaml PUBLIC
        YAML_DECLARE_STATIC
        YAML_VERSION_MAJOR=0
        YAML_VERSION_MINOR=2
        YAML_VERSION_PATCH=5
        YAML_VERSION_STRING="0.2.5"
)

# hev-task-system static library
file(GLOB_RECURSE HEV_TASK_SOURCES CONFIGURE_DEPENDS
        ${HEV_THIRD_PARTY}/hev-task-system/src/*.c
        ${HEV_THIRD_PARTY}/hev-task-system/src/*.S
)
list(FILTER HEV_TASK_SOURCES EXCLUDE REGEX "/arch/.*\\.(s|S)$")
list(APPEND HEV_TASK_SOURCES
        ${HEV_THIRD_PARTY}/hev-task-system/src/arch/arm/hev-task-execute-aarch64.s
)
set_source_files_properties(
        ${HEV_THIRD_PARTY}/hev-task-system/src/arch/arm/hev-task-execute-aarch64.s
        PROPERTIES COMPILE_FLAGS "-x assembler-with-cpp"
)
add_library(vendor_hev_task STATIC ${HEV_TASK_SOURCES})
target_include_directories(vendor_hev_task PUBLIC
        ${HEV_THIRD_PARTY}/hev-task-system/include
        ${HEV_THIRD_PARTY}/hev-task-system/src
)
target_compile_options(vendor_hev_task PRIVATE -fvisibility=hidden)
target_compile_definitions(vendor_hev_task PUBLIC
        ENABLE_STACK_OVERFLOW_DETECTION
        ENABLE_MEMALLOC_SLICE
        ENABLE_IO_SPLICE_SYSCALL
        CONFIG_STACK_BACKEND=STACK_MMAP
        CONFIG_STACK_OVERFLOW_DETECTION=1
        CONFIG_MEMALLOC_SLICE_ALIGN=64
        CONFIG_MEMALLOC_SLICE_MAX_SIZE=4096
        CONFIG_MEMALLOC_SLICE_MAX_COUNT=1000
        CONFIG_SCHED_CLOCK=CLOCK_NONE
)

# lwip static library
file(GLOB_RECURSE LWIP_SOURCES CONFIGURE_DEPENDS
        ${HEV_THIRD_PARTY}/lwip/src/*.c
        ${HEV_THIRD_PARTY}/lwip/src/*.S
)
list(FILTER LWIP_SOURCES EXCLUDE REGEX "/ports/unix/")
list(FILTER LWIP_SOURCES EXCLUDE REGEX "/ports/win32/")
add_library(vendor_lwip STATIC ${LWIP_SOURCES})
target_include_directories(vendor_lwip PUBLIC
        ${HEV_THIRD_PARTY}/lwip/src/include
        ${HEV_THIRD_PARTY}/lwip/src/ports/include
)
target_compile_definitions(vendor_lwip PUBLIC
        FD_SET_DEFINED
        SOCKLEN_T_DEFINED
)

# hev-socks5-tunnel core static library (without original JNI glue)
file(GLOB_RECURSE HEV_TUNNEL_SOURCES CONFIGURE_DEPENDS
        ${HEV_ROOT}/src/*.c
        ${HEV_ROOT}/src/*.S
)
list(FILTER HEV_TUNNEL_SOURCES EXCLUDE REGEX "hev-jni\\.c$")
add_library(hev_socks5_tunnel STATIC ${HEV_TUNNEL_SOURCES})
target_include_directories(hev_socks5_tunnel PUBLIC
        ${HEV_ROOT}/include
        ${HEV_ROOT}/src
        ${HEV_ROOT}/src/misc
        ${HEV_ROOT}/src/core/include
        ${HEV_THIRD_PARTY}/yaml/include
        ${HEV_THIRD_PARTY}/lwip/src/include
        ${HEV_THIRD_PARTY}/lwip/src/ports/include
        ${HEV_THIRD_PARTY}/hev-task-system/include
        ${HEV_THIRD_PARTY}/hev-task-system/src/kern/task
        ${HEV_THIRD_PARTY}/hev-task-system/src/lib/stack
)
target_compile_definitions(hev_socks5_tunnel PUBLIC
        ENABLE_LIBRARY
        FD_SET_DEFINED
        SOCKLEN_T_DEFINED
        COMMIT_ID=\"vendored\"
)
target_link_libraries(hev_socks5_tunnel PUBLIC
        vendor_yaml
        vendor_lwip
        vendor_hev_task
)

# Android shared library entry point
add_library(vpnbridge SHARED vpn_bridge.cpp)
target_include_directories(vpnbridge PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${HEV_ROOT}/include
)
target_link_libraries(vpnbridge PRIVATE
        hev_socks5_tunnel
)

find_library(log-lib log)
if(log-lib)
    target_link_libraries(vpnbridge PRIVATE ${log-lib})
endif()

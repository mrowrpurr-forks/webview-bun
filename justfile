# sweetview-webview-bun: build the prebuilt webview library for this OS into build/,
# where src/ffi.ts imports it from, so the npm package ships it. `just build` here.
# The recipes run under pwsh on every OS.

set shell := ["pwsh", "-NoProfile", "-Command"]

built := if os() == "windows" { "webview/build/core/Release/webview.dll" } else if os() == "macos" { "webview/build/core/Release/libwebview.dylib" } else { "webview/build/core/Release/libwebview.so" }
# Linux files are named by Bun's process.arch (x64, arm64), which scripts/build.ts and src/ffi.ts use; just's arch() says x86_64 / aarch64
bun_arch := if arch() == "x86_64" { "x64" } else if arch() == "aarch64" { "arm64" } else { arch() }
shipped := if os() == "windows" { "build/libwebview.dll" } else if os() == "macos" { "build/libwebview.dylib" } else { "build/libwebview-" + bun_arch + ".so" }

# The webview submodule (the patched library source) at the commit this branch records: fetched when the folder is empty, moved there otherwise (switching branches does not move it by itself)
[script("pwsh", "-NoProfile", "-File")]
[extension(".ps1")]
submodule:
    $ErrorActionPreference = "Stop"
    git submodule update --init; if ($LASTEXITCODE) { exit $LASTEXITCODE }
    Write-Host "webview at $((git -C webview rev-parse --short HEAD).Trim())"

# Build the library from webview/ for this OS and copy it to build/ (Windows: VS 2022 Build Tools, CMake, ninja, no cmd or .bat; macOS: Xcode CLT, CMake, ninja, universal arm64+x86_64; Linux: clang, CMake, ninja, webkitgtk 6.0)
[script("pwsh", "-NoProfile", "-File")]
[extension(".ps1")]
build: submodule
    $ErrorActionPreference = "Stop"
    $commit = (git -C webview rev-parse --short HEAD).Trim()
    Write-Host "building webview $commit for $([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)"
    if ($IsWindows) {
        $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
        if (!(Test-Path $vswhere)) { throw "vswhere.exe not found at ${vswhere}: install Visual Studio 2022 Build Tools with the C++ workload" }
        $vs = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
        if (!$vs) { throw "no Visual Studio with the C++ x86/x64 build tools found (vswhere)" }
        Import-Module "$vs\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
        Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null
        foreach ($tool in "cmake", "ninja") { if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool not on PATH: install it (winget install Kitware.CMake / Ninja-build.Ninja)" } }
        Push-Location webview
        try {
            cmake -G "Ninja Multi-Config" -B build -S . -DWEBVIEW_ENABLE_CHECKS=false -DWEBVIEW_BUILD_AMALGAMATION=false -DWEBVIEW_BUILD_EXAMPLES=false -DWEBVIEW_BUILD_STATIC_LIBRARY=false -DWEBVIEW_BUILD_TESTS=false
            $code = $LASTEXITCODE
            if (!$code) { cmake --build build --config Release; $code = $LASTEXITCODE }
        } finally { Pop-Location }
        if ($code) { exit $code }
        Copy-Item "{{built}}" "{{shipped}}" -Force
    } else {
        # scripts/build.ts: cmake + ninja with the fork's toolchain file for the OS, copies into build/ and strips
        bun scripts/build.ts; if ($LASTEXITCODE) { exit $LASTEXITCODE }
    }
    if (!(Test-Path "{{shipped}}")) { throw "build did not produce {{shipped}}" }
    Write-Host "built {{shipped}} from webview $commit ($((Get-Item '{{shipped}}').Length) bytes)"

# Remove webview's build folder; build/ (the shipped libraries) stays
clean:
    if (Test-Path webview/build) { Remove-Item webview/build -Recurse -Force }

# What `npm publish` would upload, without uploading
pack:
    npm pack --dry-run

# Publish to npmjs (run `npm login` first); the package is scoped, so --access public
publish:
    npm publish --access public

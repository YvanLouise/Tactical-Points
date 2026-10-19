[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WorkspaceRoot,
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$OutputRoot,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][int]$VersionCode,
    [Parameter(Mandatory)][string]$ApkFileName,
    [string]$Godot = $env:GODOT_PATH,
    [string]$AndroidSdk = $env:ANDROID_HOME,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$TemplateRoot = "$env:APPDATA/Godot/export_templates/4.7.stable"
)

if (-not $Godot) { $Godot = Join-Path $WorkspaceRoot 'android_test/.build/godot/Godot_v4.7-stable_win64.exe' }
if ($Godot.EndsWith('_console.exe')) { $Godot = $Godot.Replace('_console.exe', '.exe') }
if (-not $AndroidSdk) { $AndroidSdk = "$env:LOCALAPPDATA/Android/Sdk" }
if (-not $JavaHome) { $JavaHome = "$env:LOCALAPPDATA/Programs/Eclipse Adoptium/jdk-17.0.18.8-hotspot" }
if (-not (Test-Path -LiteralPath "$TemplateRoot/android_debug.apk")) { $TemplateRoot = Join-Path $WorkspaceRoot 'android_test/.build/godot/editor_data/export_templates/4.7.stable' }
if ($Version -notmatch '^\d+(\.\d+){1,2}-android-test$' -or $ApkFileName -notmatch '^shudianpai-\d+(\.\d+){1,2}-android-test\.apk$') { throw 'Invalid Android version or APK filename.' }

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$buildRoot = Join-Path $WorkspaceRoot 'android_test/.build'
$projectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$apkRoot = [IO.Path]::GetFullPath($OutputRoot)
$verificationRoot = Join-Path $apkRoot 'verification'
$portableRoot = Join-Path $buildRoot 'godot'
$editorData = Join-Path $portableRoot 'editor_data'
$templateDestination = Join-Path $editorData 'export_templates/4.7.stable'
$keyRoot = Join-Path $buildRoot 'keys'
$apk = Join-Path $apkRoot $ApkFileName
$utf8 = New-Object System.Text.UTF8Encoding($false)

foreach ($required in @($Godot, "$AndroidSdk/platform-tools/adb.exe", "$JavaHome/bin/java.exe", "$TemplateRoot/android_debug.apk", "$TemplateRoot/android_release.apk")) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing build dependency: $required"
    }
}
foreach ($directory in @($buildRoot, $apkRoot, $verificationRoot, $portableRoot, $editorData, $templateDestination, $keyRoot)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$godotExecutable = Join-Path $portableRoot 'Godot_v4.7-stable_win64.exe'
if (-not (Test-Path -LiteralPath $godotExecutable) -or (Get-Item -LiteralPath $Godot).Length -ne (Get-Item -LiteralPath $godotExecutable).Length) {
    Copy-Item -LiteralPath $Godot -Destination $godotExecutable -Force
}
$consoleSource = Join-Path (Split-Path -Parent $Godot) 'Godot_v4.7-stable_win64_console.exe'
if (-not (Test-Path -LiteralPath $consoleSource)) { throw "Godot console executable is missing: $consoleSource" }
$portableGodot = Join-Path $portableRoot 'Godot_v4.7-stable_win64_console.exe'
if ([IO.Path]::GetFullPath($consoleSource) -ne [IO.Path]::GetFullPath($portableGodot)) { Copy-Item -LiteralPath $consoleSource -Destination $portableGodot -Force }
foreach ($template in @('android_debug.apk', 'android_release.apk', 'version.txt')) {
    $source = Join-Path $TemplateRoot $template
    $destination = Join-Path $templateDestination $template
    if (-not (Test-Path -LiteralPath $destination) -or (Get-Item -LiteralPath $source).Length -ne (Get-Item -LiteralPath $destination).Length) {
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
}
[IO.File]::WriteAllText((Join-Path $portableRoot '_sc_'), '', $utf8)
$settings = @"
[gd_resource type="EditorSettings" format=3]

[resource]
export/android/java_sdk_path = "$($JavaHome.Replace('\', '/'))"
export/android/android_sdk_path = "$($AndroidSdk.Replace('\', '/'))"
"@
[IO.File]::WriteAllText((Join-Path $editorData 'editor_settings-4.7.tres'), $settings, $utf8)

$debugKeystore = Join-Path $keyRoot 'android-test.keystore'
if (-not (Test-Path -LiteralPath $debugKeystore)) { throw 'Restore android_test/.build/keys/android-test.keystore before upgrading the existing app.' }

$environmentNames = @('JAVA_HOME', 'GODOT_ANDROID_KEYSTORE_DEBUG_PATH', 'GODOT_ANDROID_KEYSTORE_DEBUG_USER', 'GODOT_ANDROID_KEYSTORE_DEBUG_PASSWORD')
$savedEnvironment = @{}
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:JAVA_HOME = $JavaHome
    $env:GODOT_ANDROID_KEYSTORE_DEBUG_PATH = $debugKeystore
    $env:GODOT_ANDROID_KEYSTORE_DEBUG_USER = 'androiddebugkey'
    $env:GODOT_ANDROID_KEYSTORE_DEBUG_PASSWORD = 'android'

    Write-Host 'Importing the standalone Android project...'
    $importLog = Join-Path $verificationRoot 'import-console.log'
    & $portableGodot --headless --path $projectRoot --import --log-file (Join-Path $verificationRoot 'import.log') *> $importLog
    if ($LASTEXITCODE -ne 0 -or (Select-String -LiteralPath $importLog -Pattern 'SCRIPT ERROR:|Parse Error:|ERROR:' -Quiet)) {
        Get-Content -LiteralPath $importLog -Tail 50
        throw 'Godot import failed. See verification/import-console.log.'
    }

    Write-Host 'Exporting the signed Android test APK...'
    $exportLog = Join-Path $verificationRoot 'export-console.log'
    & $portableGodot --headless --path $projectRoot --export-debug 'Android Test' $apk --log-file (Join-Path $verificationRoot 'export.log') *> $exportLog
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $apk) -or (Select-String -LiteralPath $exportLog -Pattern 'SCRIPT ERROR:|Parse Error:|ERROR:' -Quiet)) {
        Get-Content -LiteralPath $exportLog -Tail 50
        throw 'Android export failed. See verification/export-console.log.'
    }

    $buildTools = Get-ChildItem -LiteralPath "$AndroidSdk/build-tools" -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (-not $buildTools) { throw 'Android SDK build-tools were not found.' }
    # Older Android tools cannot open absolute paths containing non-ASCII text.
    Push-Location $apkRoot
    try {
        $apkFileName = [IO.Path]::GetFileName($apk)
        & (Join-Path $buildTools.FullName 'apksigner.bat') verify --verbose --print-certs $apkFileName *> (Join-Path $verificationRoot 'apk-signature.txt')
        if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
        & (Join-Path $buildTools.FullName 'aapt.exe') dump badging $apkFileName *> (Join-Path $verificationRoot 'apk-manifest.txt')
        if ($LASTEXITCODE -ne 0) { throw 'APK manifest verification failed.' }
        $badging = Get-Content -LiteralPath (Join-Path $verificationRoot 'apk-manifest.txt') -Raw
        if (-not $badging.Contains("versionCode='$VersionCode'") -or -not $badging.Contains("versionName='$Version'") -or -not $badging.Contains("name='com.yvanlouise.shudianpai.androidtest'")) { throw 'APK package or version does not match the requested build.' }
        $certificatePattern = 'Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)'
        $signature = Get-Content -LiteralPath (Join-Path $verificationRoot 'apk-signature.txt') -Raw
        if ($signature -notmatch $certificatePattern) { throw 'APK certificate digest is missing.' }
        $certificate = $Matches[1].ToLowerInvariant()
        $previousSignature = Join-Path $WorkspaceRoot 'android_test/verification/apk-signature.txt'
        if (Test-Path -LiteralPath $previousSignature) {
            $previous = Get-Content -LiteralPath $previousSignature -Raw
            if ($previous -match $certificatePattern -and $Matches[1].ToLowerInvariant() -ne $certificate) { throw 'The signing certificate differs from the existing Android test APK.' }
        }
        & (Join-Path $buildTools.FullName 'aapt.exe') dump xmltree $apkFileName 'AndroidManifest.xml' *> (Join-Path $verificationRoot 'apk-manifest-tree.txt')
        if ($LASTEXITCODE -ne 0) { throw 'APK manifest tree inspection failed.' }
        $manifestTree = Get-Content -LiteralPath (Join-Path $verificationRoot 'apk-manifest-tree.txt') -Raw
        if ($manifestTree -notmatch 'com\.godot\.game\.GodotAppLauncher' -or $manifestTree -notmatch 'android\.intent\.category\.LAUNCHER') {
            throw 'APK launcher activity is missing.'
        }
        & (Join-Path $buildTools.FullName 'zipalign.exe') -c -P 16 4 $apkFileName *> (Join-Path $verificationRoot 'apk-alignment.txt')
        if ($LASTEXITCODE -ne 0) { throw 'APK alignment verification failed.' }
    } finally {
        Pop-Location
    }

    Write-Host 'Checking the actual APK resources and navigation...'
    $pack = Join-Path $verificationRoot 'apk-assets.zip'
    $packRoot = Join-Path $verificationRoot 'pack-run'
    $appData = Join-Path $verificationRoot 'user'
    New-Item -ItemType Directory -Path $packRoot,$appData -Force | Out-Null
    $archive = [IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $target = [IO.Compression.ZipFile]::Open($pack, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($entry in $archive.Entries) {
                if (-not $entry.FullName.StartsWith('assets/') -or $entry.FullName.EndsWith('/')) { continue }
                if ($entry.FullName.StartsWith('assets/tools/')) { throw 'Development tools leaked into APK.' }
                $copy = $target.CreateEntry($entry.FullName.Substring(7))
                $inputStream = $entry.Open()
                $outputStream = $copy.Open()
                try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
            }
        } finally { $target.Dispose() }
    } finally { $archive.Dispose() }
    $previousAppData = $env:APPDATA
    try {
        $env:APPDATA = $appData
        $smokeLog = Join-Path $verificationRoot 'smoke.log'
        & $portableGodot --headless --path $packRoot --main-pack $pack --script (Join-Path $PSScriptRoot 'android-smoke.gd') --audio-driver Dummy *> $smokeLog
        if ($LASTEXITCODE -ne 0 -or (Select-String -LiteralPath $smokeLog -Pattern 'SCRIPT ERROR:|ERROR:|WARNING:' -Quiet) -or -not (Select-String -LiteralPath $smokeLog -Pattern 'LATEST_ANDROID_SMOKE: PASS' -Quiet)) { throw 'APK navigation check failed. See output/verification/smoke.log.' }
    } finally { $env:APPDATA = $previousAppData }

    $hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $apkRoot 'SHA256SUMS.txt'), "$hash  $([IO.Path]::GetFileName($apk))`n", $utf8)
    $timestamp = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(8)).ToString('o')
    $metadata = [ordered]@{
        built_at = $timestamp
        engine = (& $portableGodot --version | Out-String).Trim()
        package = 'com.yvanlouise.shudianpai.androidtest'
        version = $Version
        version_code = $VersionCode
        architectures = @('armeabi-v7a', 'arm64-v8a', 'x86_64')
        bytes = (Get-Item -LiteralPath $apk).Length
        sha256 = $hash
        signature_verified = $true
        signature_sha256 = $certificate
        alignment_verified = $true
        smoke_verified = $true
    }
    [IO.File]::WriteAllText((Join-Path $apkRoot 'build-info.json'), ($metadata | ConvertTo-Json), $utf8)
    Write-Host "APK ready: $apk"
    Write-Host "Size: $([math]::Round((Get-Item -LiteralPath $apk).Length / 1MB, 1)) MiB"
    Write-Host "SHA256: $hash"
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}

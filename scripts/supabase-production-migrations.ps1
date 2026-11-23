[CmdletBinding()]
param(
    [string] $ProjectDirectory = (Join-Path $PSScriptRoot '..'),
    [switch] $Apply
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$supabase = Join-Path $root 'supabase'
$baseline = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../supabase/production-baseline.json') -Raw | ConvertFrom-Json
$cli = Join-Path $PSScriptRoot '../node_modules/.bin/supabase.cmd'
if (!(Test-Path -LiteralPath $cli -PathType Leaf)) {
    throw 'Supabase CLI ausente em node_modules.'
}

$link = Join-Path $supabase '.temp/project-ref'
if (!(Test-Path -LiteralPath $link -PathType Leaf) -or
    (Get-Content -LiteralPath $link -Raw).Trim() -cne $baseline.projectRef) {
    throw 'Vincule o checkout ao projeto de produção informado em supabase/production-baseline.json.'
}

$historical = [System.Collections.Generic.List[string]]::new()
$pending = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$sha = [Security.Cryptography.SHA256]::Create()
try {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $supabase 'migrations') -Filter '*.sql' -File) {
        if ($file.Name -cnotmatch '^(?<version>\d{12}|\d{14})_.+\.sql$') {
            throw "Nome de migration inválido: $($file.Name)"
        }
        $version = $Matches.version
        if (!$seen.Add($version)) {
            throw "Versão de migration duplicada: $version"
        }

        if ([string]::CompareOrdinal($version, $baseline.cutoff) -gt 0) {
            if ($version.Length -ne 14) {
                throw "Use 14 dígitos na versão da migration: $($file.Name)"
            }
            $pending.Add($file)
            continue
        }

        $sql = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($file.FullName)).Replace(([string][char]13 + [char]10), [string][char]10)
        $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sql)))
        $historical.Add("$($file.Name) $($digest.Replace('-', '').ToLowerInvariant())")
    }

    $historical.Sort([StringComparer]::Ordinal)
    $inventory = [Text.Encoding]::UTF8.GetBytes(($historical -join [char]10))
    $fingerprint = [BitConverter]::ToString($sha.ComputeHash($inventory)).Replace('-', '').ToLowerInvariant()
    if ($historical.Count -ne $baseline.sourceFileCount -or $fingerprint -cne $baseline.sourceFingerprint) {
        throw 'Os arquivos históricos divergem da linha de base. Atualize o checkout e revise as alterações anteriores ao corte.'
    }
}
finally {
    $sha.Dispose()
}

$workdir = Join-Path ([IO.Path]::GetTempPath()) ('curtiz-supabase-' + [guid]::NewGuid().ToString('N'))
$staging = Join-Path $workdir 'supabase'
$migrations = Join-Path $staging 'migrations'
try {
    $null = New-Item -ItemType Directory -Path $migrations
    $null = New-Item -ItemType Directory -Path (Join-Path $staging '.temp')
    Copy-Item -LiteralPath (Join-Path $supabase 'config.toml') -Destination $staging
    Copy-Item -LiteralPath $link -Destination (Join-Path $staging '.temp/project-ref')

    foreach ($version in $baseline.appliedVersions) {
        if ($version -cnotmatch '^(?:\d{12}|\d{14})$') {
            throw "Versão de produção inválida: $version"
        }
        $marker = Join-Path $migrations ($version + '_production_history.sql')
        Set-Content -LiteralPath $marker -Encoding ascii -Value 'do $guard$ begin raise exception ''Historical production migration missing. Stop and verify the migration ledger.''; end; $guard$;'
    }

    foreach ($file in $pending) {
        Copy-Item -LiteralPath $file.FullName -Destination $migrations
    }

    $simulation = & $cli --workdir $workdir db push --linked --dry-run
    $result = $LASTEXITCODE
    $simulation | Write-Output
    if ($result -ne 0) {
        throw 'A simulação do Supabase falhou.'
    }
    if (($simulation -join [char]10) -match 'production_history\.sql') {
        throw 'Uma versão histórica está ausente no Supabase de produção. Confira o histórico.'
    }

    if ($Apply -and $pending.Count -gt 0) {
        & $cli --workdir $workdir db push --linked
        if ($LASTEXITCODE -ne 0) {
            throw 'O Supabase interrompeu a aplicação das migrations.'
        }
    }
}
finally {
    if (Test-Path -LiteralPath $workdir) {
        $folder = Get-Item -LiteralPath $workdir -Force
        if ($folder.FullName -cne [IO.Path]::GetFullPath($workdir) -or
            ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Diretório temporário inesperado.'
        }
        Remove-Item -LiteralPath $folder.FullName -Recurse -Force
    }
}

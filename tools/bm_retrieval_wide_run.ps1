param([ValidateSet('calibration','final','timing')][string]$Split='calibration',[int]$From=0,[int]$Count=16,[string]$Output='tmp/retrieval-wide/calibration.json')
$ErrorActionPreference='Stop'
$wideSecure=(Get-Content '../Codigo-product-next/tmp/cloud-stage/api-keys.dpapi' -Raw).Trim() | ConvertTo-SecureString
$wideConfig=([pscredential]::new('unused',$wideSecure)).GetNetworkCredential().Password | ConvertFrom-Json
$env:SUPABASE_URL=$wideConfig.url
$env:SUPABASE_SERVICE_ROLE_KEY=$wideConfig.service_role
$env:BM_CLOUD_TEST_SERVICE_ROLE_KEY=$wideConfig.service_role
$env:BM_CLOUD_TEST_ANON_KEY=$wideConfig.anon
$env:OPENAI_MODEL='gpt-5.6-luna'
if($Split -eq 'timing') {
 node tools/bm_retrieval_wide_benchmark.js --run --all-ndjson --pairs $Count --from-pair $From --baseline ../Codigo-retrieval-reference --candidate . --rates tmp/retrieval-iteration/rates.json --cases "tools/datasets/bm_retrieval_wide_${Split}_2026-10-08.json" --output $Output
} else {
 node tools/bm_retrieval_wide_benchmark.js --run --pairs $Count --from-pair $From --baseline ../Codigo-retrieval-reference --candidate . --rates tmp/retrieval-iteration/rates.json --cases "tools/datasets/bm_retrieval_wide_${Split}_2026-10-08.json" --output $Output
}
exit $LASTEXITCODE

param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRepo
$taskOut = Join-Path $taskRepo 'tmp/appstore-final'
New-Item -ItemType Directory -Path $taskOut -Force | Out-Null
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class BlankAppStoreQACredential {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct CREDENTIAL { public uint Flags;public uint Type;public string TargetName;public string Comment;public long LastWritten;public uint CredentialBlobSize;public IntPtr CredentialBlob;public uint Persist;public uint AttributeCount;public IntPtr Attributes;public string TargetAlias;public string UserName; }
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CredRead(string target,uint type,int flags,out IntPtr credential);
 [DllImport("advapi32.dll")] static extern void CredFree(IntPtr credential);
 public static string Read(){IntPtr ptr;if(!CredRead("Supabase CLI:supabase",1,0,out ptr))throw new Exception("supabase_credential_unavailable");try{var c=(CREDENTIAL)Marshal.PtrToStructure(ptr,typeof(CREDENTIAL));var b=new byte[c.CredentialBlobSize];Marshal.Copy(c.CredentialBlob,b,0,b.Length);return System.Text.Encoding.UTF8.GetString(b).TrimEnd((char)0);}finally{CredFree(ptr);}}
}
'@
$taskToken = [BlankAppStoreQACredential]::Read()
$taskEndpoint = 'https://api.supabase.com/v1/projects/njqbovsmoowkhhsqmitn/database/query'
function Invoke-BlankQAQuery([string]$query) {
    Invoke-RestMethod -Uri $taskEndpoint -Method Post -Headers @{Authorization="Bearer $taskToken"} -ContentType 'application/json' -Body (@{query=$query}|ConvertTo-Json -Compress)
}
try {
    $taskBefore = Invoke-BlankQAQuery @'
begin transaction read only;
select jsonb_build_object(
 'history',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version in ('031','032','033','034')),
 'language',(select count(*)=1 from information_schema.columns where table_schema='public' and table_name='assistant_app_turns' and column_name='response_language'),
 'protected_tables',(select count(*)=2 and bool_and(c.relrowsecurity and not has_table_privilege('authenticated',c.oid,'SELECT')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('assistant_voice_requests','assistant_voice_global_usage'))
) as preflight;
rollback;
'@
    $taskState = $taskBefore[0].preflight
    foreach ($taskVersion in @('031','032','033')) { if($taskState.history -notcontains $taskVersion){throw 'qa_voice_schema_prerequisite_missing'} }
    if(-not $taskState.protected_tables){throw 'qa_voice_tables_not_protected'}
    $taskApplied = @()
    if(($taskState.history -contains '034') -ne [bool]$taskState.language){throw 'qa_language_history_requires_reconcile'}
    if(-not $taskState.language -and $Apply){
        if(git status --porcelain){throw 'commit_candidate_before_qa_mutation'}
        $taskSQL = Get-Content -LiteralPath 'supabase/migrations/034_assistant_response_language.sql' -Raw
        if($taskSQL.Contains('$blank_source$')){throw 'migration_quote_collision'}
        $taskGuard = @'
begin;
select pg_advisory_xact_lock(hashtextextended('blank-appstore-private-qa-034',0));
DO $$ BEGIN IF EXISTS(select 1 from supabase_migrations.schema_migrations where version='034') OR EXISTS(select 1 from information_schema.columns where table_schema='public' and table_name='assistant_app_turns' and column_name='response_language') THEN RAISE EXCEPTION 'qa_schema_changed_requires_reconcile'; END IF; END $$;
'@
        $taskHistory = "`ninsert into supabase_migrations.schema_migrations(version,name,statements) values('034','assistant_response_language',ARRAY[`$blank_source`$$taskSQL`$blank_source`$]);`ncommit;"
        $null = Invoke-BlankQAQuery ($taskGuard + "`n" + $taskSQL + $taskHistory)
        $taskApplied = @('034')
    }
    $taskReceipt = @{generated_at=[DateTime]::UtcNow.ToString('o');project='njqbovsmoowkhhsqmitn';source_commit=(git rev-parse HEAD);before=$taskState;applied=$taskApplied;production_mutations=0}
    $taskReceipt|ConvertTo-Json -Depth 12|Set-Content -LiteralPath (Join-Path $taskOut 'qa-schema-preparation.json') -Encoding utf8
    Write-Output ($taskReceipt|ConvertTo-Json -Depth 12 -Compress)
} finally { $taskToken=$null }

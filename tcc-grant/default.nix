{
  lib,
  nushell,
  sqlite,
  writeScriptBin,
}:
# tcc-grant: write one TCC grant (service × client) into a TCC.db, optionally
# pinned to a code requirement. A Nushell script; sqlite3 is put on PATH and
# codesign/csreq/xxd come from /usr/bin.
(writeScriptBin "tcc-grant" ''
  #!${lib.getExe nushell} --no-config-file
  $env.PATH = ["${lib.getBin sqlite}/bin"] ++ ($env.PATH? | default [])

  ${builtins.readFile ./tcc-grant.nu}
'').overrideAttrs
  (old: {
    meta = (old.meta or { }) // {
      description = "Grant a macOS TCC permission by writing TCC.db, optionally csreq-pinned";
      mainProgram = "tcc-grant";
      platforms = lib.platforms.darwin;
      license = lib.licenses.mit;
    };
  })

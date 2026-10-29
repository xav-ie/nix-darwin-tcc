# Declarative TCC (Privacy & Security) grants for nix-darwin.
#
# Writes allow-rows straight into the TCC databases at activation, so camera,
# microphone, accessibility, … permissions are part of the system config
# instead of a click-through in System Settings. Writing the system TCC.db
# needs SIP disabled; see README.md.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.security.tcc;

  tccGrant = lib.getExe cfg.package;

  home =
    let
      declared = config.users.users.${cfg.user}.home or null;
    in
    if declared == null then "/Users/${cfg.user}" else toString declared;

  # These services live in the SYSTEM TCC.db (/Library/...); everything else
  # (Camera, Microphone, AppleEvents, …) lives in the per-user db. A grant to
  # the wrong db is silently inert.
  systemServices = [
    "Accessibility"
    "FullDiskAccess"
    "ScreenCapture"
    "DeveloperTool"
    "InputMonitoring"
    "PostEvent"
  ];
  dbFor = service: if builtins.elem service systemServices then "$SYS_TCC_DB" else "$USER_TCC_DB";

  # cdhash pins name an immutable store bundle, so they can be written in
  # preActivation, before launchd (re)loads the agents that run those
  # bundles: a rebuilt daemon then never launches against a grant pinned to
  # its previous build (which pops the system "would like to control this
  # computer" prompt). Everything else waits for postActivation — designated
  # pins read the bundle's signature after its owner re-signs it.
  isEarly = app: app.appPath != "" && app.pin == "cdhash";
  earlyApps = lib.filter isEarly cfg.apps;
  lateApps = lib.filter (app: !isEarly app) cfg.apps;

  # Generate grant commands for the given apps and their services
  grantCommands = lib.concatMapStringsSep "\n" (
    app:
    let
      # Apps whose bundle is mutated in place (e.g. Firefox autoconfig
      # injection) lose their Apple seal; under amfi_get_out_of_my_way=1 tccd
      # then treats them as unsigned platform binaries and denies everything.
      # The fix is to re-sign them with an Apple-anchored cert — that re-sign
      # must run before this module's postActivation step (it typically needs
      # keychain access, so it lives in a user-level activation of whichever
      # module owns the app). Here we only pin the csreq.
      #
      # pin = "designated" (default): read the bundle's *current* designated
      # requirement (--designated-from). Cert-anchored, so it auto-tracks
      # whatever cert the re-sign used and survives rotation with no config
      # change. Correct for cert-signed apps (Firefox).
      #
      # pin = "cdhash": pin the raw cdhash (--app-path). For ad-hoc/self-signed
      # store bundles (e.g. a daemon you build yourself) that have no cert
      # anchor for a DR; the legacy-SHA-1 cdhash matches because the bundle is
      # itself ad-hoc signed.
      pinArg =
        if app.appPath == "" then
          ""
        else if app.pin == "cdhash" then
          " --app-path \"${app.appPath}\""
        else
          " --designated-from \"${app.appPath}\"";

      services = lib.concatMapStringsSep "\n" (
        service:
        if app.path != null then
          "${tccGrant} --service ${service} --bundle-id \"${app.path}\" --client-type 1 --db \"${dbFor service}\""
        else
          "${tccGrant} --service ${service} --bundle-id ${app.bundleId} --db \"${dbFor service}\"${pinArg}"
      ) app.services;
    in
    ''
      # ${if app.path != null then app.path else app.bundleId}
      ${services}
    ''
  );

  dbVars = lib.removeSuffix "\n" ''
    USER_TCC_DB="${home}/Library/Application Support/com.apple.TCC/TCC.db"
    SYS_TCC_DB="/Library/Application Support/com.apple.TCC/TCC.db"
  '';
in
{
  options.security.tcc = {
    enable = lib.mkEnableOption "declarative TCC permission management";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ./tcc-grant { };
      defaultText = lib.literalExpression "pkgs.callPackage ./tcc-grant { }";
      description = "The tcc-grant tool the activation scripts run.";
    };

    user = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = config.system.primaryUser;
      defaultText = lib.literalExpression "config.system.primaryUser";
      description = ''
        The user whose per-user TCC.db (Camera, Microphone, AppleEvents, …)
        receives grants, and whose tccd is reloaded after writing.
      '';
      example = "alice";
    };

    apps = lib.mkOption {
      type = lib.types.listOf (
        lib.types.submodule {
          options = {
            bundleId = lib.mkOption {
              type = lib.types.str;
              default = "";
              description = ''
                Application bundle identifier (e.g., org.whispersystems.signal-desktop).
                Set this or `path`.
              '';
              example = "org.whispersystems.signal-desktop";
            };

            path = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = ''
                Absolute path of a command-line tool to grant instead of an app
                bundle (TCC client type 1). TCC identifies unbundled binaries by
                path, so a bundle-id grant never matches them. A store path
                changes on every rebuild of the tool; interpolate the package
                (`"''${pkg}/bin/tool"`) so the grant follows it. Pinning
                (`appPath`/`pin`) doesn't apply.
              '';
              example = lib.literalExpression ''"''${pkgs.some-cli}/bin/some-cli"'';
            };

            appPath = lib.mkOption {
              type = lib.types.str;
              default = "";
              description = ''
                Absolute path to the .app bundle. When set, the grant is pinned to
                the bundle's code signature (see `pin`) instead of a bare
                bundle-id match — required for re-signed apps, whose
                ad-hoc/cert seal has no anchor a bundle-id grant can trust.
              '';
              example = "/Applications/Firefox.app";
            };

            pin = lib.mkOption {
              type = lib.types.enum [
                "designated"
                "cdhash"
              ];
              default = "designated";
              description = ''
                How to pin the csreq when appPath is set. "designated" reads the
                bundle's current designated requirement (cert-anchored, survives
                cert rotation) — use for re-signed apps like Firefox. "cdhash"
                pins the raw cdhash — use for ad-hoc/self-signed store bundles
                (e.g. a daemon you build yourself) that have no cert anchor for a
                designated requirement. Only meaningful together with appPath.
                cdhash-pinned grants are written in preActivation, before launchd
                reloads agents; everything else in postActivation.
              '';
            };

            resignIdentity = lib.mkOption {
              type = lib.types.str;
              default = "";
              description = ''
                Coarse codesign-identity matcher (a substring of the cert name, e.g.
                "Apple Development") that the app's bundle is re-signed with. This
                module does NOT use it directly — the module that owns the app
                reads it (e.g. via osConfig) and resolves the exact identity from
                the login keychain at activation, so cert rotation needs no config
                change. Declared here so intent lives next to the grant; pair with
                appPath.

                Needed for bundles mutated in place — e.g. Firefox, whose autoconfig
                injection breaks the Apple seal; under amfi_get_out_of_my_way=1 a
                broken/ad-hoc seal makes tccd treat the app as an unsigned platform
                binary and deny camera/mic/screen-capture. Must resolve to an
                Apple-anchored cert (ad-hoc does not work).
              '';
              example = "Apple Development";
            };

            services = lib.mkOption {
              type = lib.types.listOf (
                lib.types.enum [
                  # Media
                  "Camera"
                  "Microphone"
                  "ScreenCapture"
                  # Automation
                  "Accessibility"
                  "AppleEvents"
                  "InputMonitoring"
                  "PostEvent"
                  # Data
                  "AddressBook"
                  "Calendar"
                  "Reminders"
                  "Photos"
                  # System
                  "SpeechRecognition"
                  "FullDiskAccess"
                  "DeveloperTool"
                  "DownloadsFolder"
                  "DesktopFolder"
                  "DocumentsFolder"
                  "Location"
                  "FocusStatus"
                ]
              );
              default = [
                "Camera"
                "Microphone"
              ];
              description = "TCC services to grant access to";
            };
          };
        }
      );
      default = [ ];
      description = "Applications to grant TCC permissions to";
      example = lib.literalExpression ''
        [
          { bundleId = "org.whispersystems.signal-desktop"; services = [ "Camera" "Microphone" "ScreenCapture" ]; }
          { bundleId = "com.mitchellh.ghostty"; services = [ "Accessibility" "FullDiskAccess" ]; }
        ]
      '';
    };
  };

  config = lib.mkIf (cfg.enable && cfg.apps != [ ]) {
    assertions = map (app: {
      assertion = (app.bundleId != "") != (app.path != null);
      message = "security.tcc.apps: set exactly one of bundleId or path (got bundleId=\"${app.bundleId}\", path=${toString app.path})";
    }) cfg.apps ++ [
      {
        assertion = cfg.user != null;
        message = "security.tcc.user must be set (it defaults to system.primaryUser, which is unset).";
      }
    ];

    # Grant at activation (runs as root). System-db writes work because SIP is
    # off; reload tccd so it picks them up without a logout. tcc-grant skips
    # already-allowed entries, so existing System-Settings grants are safe.
    system.activationScripts.preActivation.text = lib.mkIf (earlyApps != [ ]) (
      lib.mkAfter ''
        echo "Ensuring build-pinned TCC permissions for ${cfg.user}..."
        ${dbVars}
        ${grantCommands earlyApps}
        # Only when a pinned build changed: reload tccd and give it a moment
        # (the kickstart is async, with no readiness signal) so the agents
        # launchd is about to relaunch see the new grant.
        early_hash="${builtins.hashString "sha256" (builtins.toJSON earlyApps)}"
        early_marker="/var/lib/nix-darwin/tcc-early.hash"
        if [ "$(cat "$early_marker" 2>/dev/null)" != "$early_hash" ]; then
          sudo -u ${cfg.user} launchctl kickstart -k \
            "gui/$(id -u ${cfg.user})/com.apple.tccd" 2>/dev/null || true
          sleep 1
          mkdir -p "$(dirname "$early_marker")"
          echo "$early_hash" > "$early_marker"
        fi
      ''
    );

    system.activationScripts.postActivation.text = lib.mkAfter ''
      echo "Ensuring TCC permissions for ${cfg.user}..."
      ${dbVars}
      ${grantCommands lateApps}
      sudo -u ${cfg.user} launchctl kickstart -k \
        "gui/$(id -u ${cfg.user})/com.apple.tccd" 2>/dev/null || true
    '';
  };
}

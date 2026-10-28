{
  description = "Development flake for nix-darwin-tcc: checks and a standalone tcc-grant";

  # Kept out of the main flake so its consumers don't inherit these inputs.
  inputs = {
    nix-darwin-tcc.url = "path:..";
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      nix-darwin-tcc,
      nixpkgs,
      nix-darwin,
      ...
    }:
    let
      self = nix-darwin-tcc;
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        tcc-grant = pkgs.callPackage ../tcc-grant { };
        default = tcc-grant;
      });

      # Evaluate the module inside a minimal nix-darwin system and keep the
      # generated activation text, so `nix flake check` catches option or
      # script regressions without building a whole system.
      checks = forAllSystems (
        pkgs:
        let
          darwin = nix-darwin.lib.darwinSystem {
            modules = [
              self.darwinModules.default
              {
                nixpkgs.hostPlatform = pkgs.stdenv.hostPlatform.system;
                system.stateVersion = 6;
                system.primaryUser = "alice";
                security.tcc = {
                  enable = true;
                  apps = [
                    {
                      bundleId = "org.whispersystems.signal-desktop";
                      services = [
                        "Camera"
                        "Microphone"
                      ];
                    }
                    {
                      bundleId = "org.mozilla.firefox";
                      appPath = "/Applications/Firefox.app";
                      services = [ "ScreenCapture" ];
                    }
                    {
                      bundleId = "com.example.daemon";
                      appPath = "/nix/store/example-daemon/Applications/Daemon.app";
                      pin = "cdhash";
                      services = [ "Accessibility" ];
                    }
                  ];
                };
              }
            ];
          };
          scripts = darwin.config.system.activationScripts;
        in
        {
          tcc-grant = pkgs.callPackage ../tcc-grant { };
          module = pkgs.runCommand "tcc-module-activation" { } ''
            cat > pre <<'EOF'
            ${scripts.preActivation.text}
            EOF
            cat > post <<'EOF'
            ${scripts.postActivation.text}
            EOF
            # The cdhash-pinned grant is written before launchd reloads agents,
            # everything else after.
            grep -q 'bundle-id com.example.daemon .*--app-path' pre
            ! grep -q 'com.example.daemon' post
            grep -q 'bundle-id org.mozilla.firefox .*--designated-from' post
            grep -q 'bundle-id org.whispersystems.signal-desktop' post
            grep -q 'USER_TCC_DB="/Users/alice/Library' post
            mkdir $out && cp pre post $out/
          '';
        }
      );
    };
}

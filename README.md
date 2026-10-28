# nix-darwin-tcc

Declarative macOS **TCC** (Transparency, Consent & Control — the
*Privacy & Security* permissions) for [nix-darwin].

Camera, microphone, screen recording, accessibility, full-disk access and the
rest become part of your system configuration: at activation the module writes
allow-rows directly into the TCC databases, optionally pinned to the app's code
signature, and reloads `tccd`. No clicking through System Settings after every
rebuild.

```nix
security.tcc = {
  enable = true;
  apps = [
    { bundleId = "org.whispersystems.signal-desktop"; services = [ "Camera" "Microphone" "ScreenCapture" ]; }
    { bundleId = "com.mitchellh.ghostty"; services = [ "Accessibility" "FullDiskAccess" ]; }
  ];
};
```

## Requirements and caveats

- **SIP must be disabled** (`csrutil disable` from Recovery) for grants to the
  *system* database (`/Library/Application Support/com.apple.TCC/TCC.db`):
  Accessibility, FullDiskAccess, ScreenCapture, InputMonitoring, PostEvent,
  DeveloperTool. Per-user services (Camera, Microphone, AppleEvents, Contacts,
  …) go to `~/Library/Application Support/com.apple.TCC/TCC.db`; writing that
  file also needs SIP off or Full Disk Access for the activating process.
- This writes Apple's private database schema directly. It works on current
  macOS (Sequoia/Tahoe), but Apple can change the schema in any release.
- Existing allows granted through System Settings are left alone (a
  bundle-id-only grant never overwrites an existing allow).
- Granting is not revoking: removing an app from `apps` does not delete its row.

## Usage (flake)

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    # No inputs of its own, so no `follows` needed.
    nix-darwin-tcc.url = "github:xav-ie/nix-darwin-tcc";
  };

  outputs = { nix-darwin, nix-darwin-tcc, ... }: {
    darwinConfigurations.my-mac = nix-darwin.lib.darwinSystem {
      modules = [
        nix-darwin-tcc.darwinModules.default
        {
          system.primaryUser = "alice";
          security.tcc = {
            enable = true;
            apps = [
              { bundleId = "us.zoom.xos"; services = [ "Camera" "Microphone" "ScreenCapture" ]; }
            ];
          };
        }
      ];
    };
  };
}
```

The module builds the `tcc-grant` tool from your own nixpkgs. To use it on its
own, add `nix-darwin-tcc.overlays.default` to your nixpkgs overlays (for
`pkgs.tcc-grant`), or run it straight from the dev flake:
`nix run "github:xav-ie/nix-darwin-tcc?dir=dev#tcc-grant" -- --help`.

```sh
sudo tcc-grant --service Accessibility --bundle-id com.example.app \
  --db "/Library/Application Support/com.apple.TCC/TCC.db"
```

## Options

| Option | Default | |
|---|---|---|
| `security.tcc.enable` | `false` | Turn the module on. |
| `security.tcc.user` | `system.primaryUser` | User whose per-user TCC.db is written and whose `tccd` is reloaded. |
| `security.tcc.package` | bundled `tcc-grant` | The grant tool the activation scripts run. |
| `security.tcc.apps` | `[ ]` | List of grants, below. |

Each entry of `apps`:

| Field | Default | |
|---|---|---|
| `bundleId` | — | The app's bundle identifier. |
| `services` | `[ "Camera" "Microphone" ]` | Any of: Camera, Microphone, ScreenCapture, Accessibility, AppleEvents, InputMonitoring, PostEvent, AddressBook, Calendar, Reminders, Photos, SpeechRecognition, FullDiskAccess, DeveloperTool, DownloadsFolder, DesktopFolder, DocumentsFolder, Location, FocusStatus. |
| `appPath` | `""` | Path to the `.app`. When set, the grant is pinned to its code signature (see `pin`). |
| `pin` | `"designated"` | `"designated"` or `"cdhash"`; only used with `appPath`. |
| `resignIdentity` | `""` | Informational: the codesign identity a module that owns the app re-signs it with. Not read by this module. |

## How pinning works

A TCC row can carry a *code requirement* (csreq) that the requesting binary must
satisfy. Without one, the grant matches by bundle id alone, which is fine for
normally signed apps.

- **`pin = "designated"`** reads the bundle's current designated requirement
  (`codesign -d -r-`) at activation and pins it. It is cert-anchored, so it
  keeps matching across updates and cert rotation. Use it for apps you
  re-sign yourself — for example a Firefox whose bundle you modify (autoconfig
  injection breaks Apple's seal; under `amfi_get_out_of_my_way=1` a broken or
  ad-hoc seal makes tccd treat the app as an unsigned platform binary and deny
  camera/mic/screen recording, so it has to be re-signed with an
  Apple-anchored cert). The re-sign must run before this module's
  postActivation step.
- **`pin = "cdhash"`** pins the bundle's exact cdhash. Use it for ad-hoc signed
  bundles you build with Nix (agents, daemons): they have no certificate to
  anchor a designated requirement to. Every rebuild produces a new cdhash, and
  the grant is re-pinned on each activation.

### Ordering

nix-darwin activation runs `preActivation`, then reloads launchd agents and
daemons, then `postActivation`. cdhash-pinned grants name an immutable store
bundle, so they are written in **preActivation**: a rebuilt agent is relaunched
with its new grant already in place, instead of starting against the previous
build's grant (and popping the system "would like to control this computer"
prompt). All other grants are written in **postActivation**, after any
re-signing has happened. When anything was written, `tccd` is reloaded so the
new rows take effect without logging out.

[nix-darwin]: https://github.com/nix-darwin/nix-darwin

## Development

The main flake has no inputs. Checks and a standalone `tcc-grant` build live in
the [`dev/`](dev/flake.nix) flake, which brings nixpkgs and nix-darwin:

```sh
nix flake check ./dev
nix build ./dev#tcc-grant
```

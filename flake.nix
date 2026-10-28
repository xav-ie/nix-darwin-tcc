{
  description = "Declarative macOS TCC (Privacy & Security) permissions for nix-darwin";

  # No inputs: the module builds tcc-grant from your own nixpkgs, so taking this
  # flake adds nothing to your lock file. Checks and a standalone tcc-grant
  # build live in ./dev, which has its own inputs.
  outputs =
    { self }:
    {
      darwinModules.default = ./module.nix;
      darwinModules.tcc = self.darwinModules.default;

      overlays.default = final: _prev: {
        tcc-grant = final.callPackage ./tcc-grant { };
      };
    };
}

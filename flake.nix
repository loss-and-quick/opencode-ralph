{
  description = "Ralph Wiggum iterative loop plugin for OpenCode";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [ pkgs.bun pkgs.nodejs ];
        };

        packages.default = pkgs.stdenvNoCC.mkDerivation {
          pname = "opencode-ralph";
          version = "1.0.0";

          src = ./.;

          installPhase = ''
            mkdir -p $out
            cp -r src command package.json $out/
          '';

          meta = {
            description = "Ralph Wiggum iterative loop plugin for OpenCode";
            license = pkgs.lib.licenses.mit;
          };
        };
      }
    );
}

{
  description = "Readermost — a Google Reader for a Mattermost crowd";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      version = "0.1.0";

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems =
        f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        frontend = pkgs.callPackage ./nix/frontend.nix { inherit version; };
        readermost = pkgs.callPackage ./nix/package.nix { inherit version frontend; };
        default = readermost;
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            go
            gopls
            gotools
            go-tools
            golangci-lint
            nodejs_24
            sqlite
            prefetch-npm-deps
            jq
            curl
            openssl
          ];

          shellHook = ''
            echo "readermost devshell — go $(go version | cut -d' ' -f3), node $(node --version)"
          '';
        };
      });

      checks = forAllSystems (
        pkgs:
        let
          inherit (pkgs.stdenv.hostPlatform) system;
        in
        {
          inherit (self.packages.${system}) readermost frontend;
        }
        # The NixOS module only exists on Linux.
        // nixpkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux (
          import ./nix/checks.nix {
            inherit pkgs self version;
            inherit (nixpkgs) lib;
            readermost = self.packages.${system}.readermost;
          }
        )
      );

      nixosModules.default = import ./nix/module.nix { inherit self; };

      formatter = forAllSystems (pkgs: pkgs.nixfmt-rfc-style);
    };
}

{
  pkgs,
  lib,
  self,
  version,
  readermost,
}:

let
  system = pkgs.stdenv.hostPlatform.system;

  # Evaluate the NixOS module against a minimal machine. Forcing only the
  # systemd unit keeps this cheap while still proving the module's options,
  # types and LoadCredential wiring actually evaluate.
  evaluated = lib.nixosSystem {
    inherit system;
    modules = [
      self.nixosModules.default
      (
        { ... }:
        {
          boot.loader.grub.enable = false;
          fileSystems."/" = {
            device = "/dev/null";
            fsType = "ext4";
          };
          system.stateVersion = "24.05";

          services.readermost = {
            enable = true;
            settings = {
              listen_addr = ":8080";
              public_url = "https://reader.example.org";
              mattermost.url = "https://mm.example.org";
              miniflux.url = "https://miniflux.internal";
            };
            secrets = {
              encryption_key = "/run/secrets/key";
              mattermost_oauth_client_secret = "/run/secrets/mm";
              miniflux_admin_password = "/run/secrets/miniflux";
            };
          };
        }
      )
    ];
  };

  unit = evaluated.config.systemd.services.readermost.serviceConfig;
in
{
  # Go tests across every package, not just the one the binary builds from.
  tests = readermost.overrideAttrs (old: {
    pname = "readermost-tests";
    subPackages = null;
    doCheck = true;
    # Nothing to install: this derivation exists for its check phase.
    installPhase = ''
      runHook preInstall
      mkdir -p $out
      echo "tests passed" > $out/result
      runHook postInstall
    '';
  });

  module-eval = pkgs.runCommand "readermost-module-eval" { } ''
    echo "ExecStart: ${builtins.head (lib.toList unit.ExecStart)}" > $out
    echo "credentials: ${lib.concatStringsSep " " unit.LoadCredential}" >> $out
    ${lib.optionalString (!unit.DynamicUser) "exit 1"}
  '';
}

{ self }:
{ config, lib, pkgs, ... }:

let
  cfg = config.services.readermost;
  inherit (lib) mkEnableOption mkOption mkIf types;

  settingsFormat = pkgs.formats.toml { };
  configFile = settingsFormat.generate "readermost.toml" cfg.settings;
in
{
  options.services.readermost = {
    enable = mkEnableOption "Readermost, a Google Reader for a Mattermost crowd";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.readermost;
      defaultText = lib.literalMD "the flake's `readermost` package";
      description = "The readermost package to run.";
    };

    settings = mkOption {
      inherit (settingsFormat) type;
      default = { };
      description = ''
        Contents of readermost.toml. Do not put secrets here — this file lands in
        the world-readable Nix store. Use {option}`services.readermost.secrets`,
        and reference the values as `file:$CREDENTIALS_DIRECTORY/<name>` (the
        module wires `$CREDENTIALS_DIRECTORY` for you).
      '';
      example = lib.literalExpression ''
        {
          listen_addr = ":8080";
          public_url = "https://reader.example.org";
          mattermost.url = "https://mm.example.org";
          miniflux.url = "https://miniflux.internal";
        }
      '';
    };

    secrets = mkOption {
      type = types.attrsOf types.path;
      default = { };
      description = ''
        Secrets loaded via systemd `LoadCredential`, keeping them out of the Nix
        store. Expected keys: `encryption_key`, `mattermost_oauth_client_secret`,
        `miniflux_admin_password`.
      '';
      example = lib.literalExpression ''
        {
          encryption_key = "/run/secrets/readermost-key";
          mattermost_oauth_client_secret = "/run/secrets/readermost-mm";
          miniflux_admin_password = "/run/secrets/readermost-miniflux";
        }
      '';
    };
  };

  config = mkIf cfg.enable {
    systemd.services.readermost = {
      description = "Readermost feed reader";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      serviceConfig = {
        ExecStart = "${lib.getExe cfg.package} --config ${configFile}";
        Restart = "on-failure";
        RestartSec = "5s";

        DynamicUser = true;
        StateDirectory = "readermost";
        WorkingDirectory = "/var/lib/readermost";
        LoadCredential = lib.mapAttrsToList (name: path: "${name}:${path}") cfg.secrets;

        # Hardening
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        SystemCallArchitectures = "native";
        SystemCallFilter = [ "@system-service" "~@privileged" ];
      };
    };
  };
}

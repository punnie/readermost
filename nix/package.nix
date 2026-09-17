{ lib, buildGoModule, version, frontend }:

buildGoModule {
  pname = "readermost";
  inherit version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../go.mod
      ../go.sum
      ../cmd
      ../internal
      ../web/embed.go
    ];
  };

  vendorHash = "sha256-UfEkRaUT38HIkjW4xwvQZRG/piW9bZMvH/todXfVhQI=";

  # modernc.org/sqlite is pure Go: keep the output a standalone binary.
  env.CGO_ENABLED = 0;

  # go:embed needs the built assets present at compile time.
  preBuild = ''
    mkdir -p web/dist
    cp -r ${frontend}/. web/dist/
  '';

  ldflags = [
    "-s"
    "-w"
    "-X main.version=${version}"
  ];

  subPackages = [ "cmd/readermost" ];

  meta = {
    description = "A Google Reader for a Mattermost crowd";
    mainProgram = "readermost";
    license = lib.licenses.mit;
  };
}

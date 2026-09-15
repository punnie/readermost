{ lib, buildNpmPackage, version }:

buildNpmPackage {
  pname = "readermost-web";
  inherit version;

  src = lib.cleanSource ../web;

  npmDepsHash = "sha256-rlly+Pq6bNpCBza0BftCDae85RsaECuIJUk25+Z/vQ8=";

  # Vite writes to dist/; there is nothing to "install" in the npm sense.
  dontNpmInstall = true;

  # The frontend's own unit tests run as part of the build, so nix flake check
  # covers them alongside the Go ones.
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm run test:run
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';

  meta = {
    description = "Readermost frontend assets";
    license = lib.licenses.mit;
  };
}

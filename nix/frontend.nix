{ lib, buildNpmPackage, version }:

buildNpmPackage {
  pname = "readermost-web";
  inherit version;

  src = lib.cleanSource ../web;

  npmDepsHash = "sha256-1VaF4YCua3VPKy0YqUvyxqmRegLL3A8CBu6G0JZwZ90=";

  # Vite writes to dist/; there is nothing to "install" in the npm sense.
  dontNpmInstall = true;

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

# Entwicklungsumgebung für EVtivity (NixOS/WSL). Wird über .envrc von direnv geladen.
{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = with pkgs; [
    nodejs_24
    postgresql_17 # psql, pg_dump, pg_restore für die Pilot-Dumps
    gh
    jq
    openssl # TLS-Test in packages/ocpp erzeugt ein Testzertifikat
  ];
}

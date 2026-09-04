#!/usr/bin/env bash
# The global identity itself does not name the signing key's owner —
# no clone overrides anything, so check 15 has nothing to find.
#
# The key is a throwaway generated for this fixture; only its public
# half ships, which is all the uid lookup needs.
set -eu
. ./_lib.sh
kata_repo skills clean

export GNUPGHOME="$PWD/home/.gnupg"
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
gpg --batch --quiet --import ./signer.pub.asc

# Global, not local: this is what the harness leaves behind when the
# signing setup exits before deriving the identity from the key.
cat > "$PWD/home/.gitconfig" <<'CONFIG'
[user]
	name = Claude
	email = noreply@anthropic.com
	signingkey = 7658473884802AD3
CONFIG

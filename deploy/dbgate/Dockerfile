FROM dbgate/dbgate@sha256:fc68e7c433963bff17af7372ce87f4b94873551a1c1b124220c8c04a22a80311
# The upstream arm64 image contains an x86-64 SQLite addon. Rebuild the
# package's native dependency for the image's actual Node/CPU architecture.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && npm rebuild better-sqlite3 --build-from-source \
 && node -e "const db=require('better-sqlite3')(':memory:');db.prepare('select 1').get();db.close()" \
 && apt-get purge -y --auto-remove python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

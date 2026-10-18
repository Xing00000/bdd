// Compatibility facade. Validation and the resolver contract belong to domain.
export { requiredRecordingSecretAliases, resolveRecordingSecrets, allowlistedRecordingSecretResolver } from '../../domain/recording-secrets.js';
export type { RecordingSecretBinding, RecordingSecretResolver } from '../../domain/recording-secrets.js';

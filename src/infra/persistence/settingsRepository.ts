import type { SettingsRepository } from '../../types/ports';
import type { UserId, Settings } from '../../types/domain';
import { APP_SCHEMA_VERSION, type LexiaDb } from './lexiaDb';

/** Display/preference settings; write stamps the current schema version (13.3). */
export class DexieSettingsRepository implements SettingsRepository {
  constructor(private readonly db: LexiaDb) {}

  get(userId: UserId): Promise<Settings | undefined> {
    return this.db.settings.get(userId);
  }

  async put(settings: Settings): Promise<void> {
    await this.db.settings.put({ ...settings, appSchemaVersion: APP_SCHEMA_VERSION });
  }
}

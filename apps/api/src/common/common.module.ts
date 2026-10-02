import { Global, Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { SecretBoxService } from './secret-box.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [ActivityLogService, SecretBoxService, SettingsService],
  exports: [ActivityLogService, SecretBoxService, SettingsService],
})
export class CommonModule {}

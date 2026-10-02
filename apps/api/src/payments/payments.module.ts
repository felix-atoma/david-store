import { Module } from '@nestjs/common';
import { AdminPaymentSettingsController } from './admin-payment-settings.controller';
import { HubtelService } from './hubtel.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController, AdminPaymentSettingsController],
  providers: [HubtelService, PaymentsService],
  exports: [HubtelService, PaymentsService],
})
export class PaymentsModule {}

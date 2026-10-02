import { Module } from '@nestjs/common';
import { AdminPaymentSettingsController } from './admin-payment-settings.controller';
import { HubtelService } from './hubtel.service';
import { PaystackService } from './paystack.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController, AdminPaymentSettingsController],
  providers: [HubtelService, PaystackService, PaymentsService],
  exports: [HubtelService, PaystackService, PaymentsService],
})
export class PaymentsModule {}

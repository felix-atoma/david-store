import { Module } from '@nestjs/common';
import { HubtelService } from './hubtel.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [HubtelService, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

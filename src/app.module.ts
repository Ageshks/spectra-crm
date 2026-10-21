import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configuration } from './config/configuration';
import { AuditModule } from './common/audit/audit.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { RedisModule } from './common/redis/redis.module';
import { SequenceModule } from './common/sequence/sequence.module';
import { SettingsModule } from './common/settings/settings.module';
import { UploadsModule } from './common/uploads/uploads.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DatabaseModule } from './database/database.module';
import { HousekeepingModule } from './jobs/housekeeping.module';
import { WorkersModule } from './jobs/workers.module';
import { AuthModule } from './modules/auth/auth.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { EnquiriesModule } from './modules/enquiries/enquiries.module';
import { ExportsModule } from './modules/exports/exports.module';
import { HealthModule } from './modules/health/health.module';
import { LeaveModule } from './modules/leave/leave.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ManagersModule } from './modules/managers/managers.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OvertimeModule } from './modules/overtime/overtime.module';
import { ServiceCategoriesModule } from './modules/service-categories/service-categories.module';
import { ServiceReportsModule } from './modules/service-reports/service-reports.module';
import { ServicesModule } from './modules/services/services.module';
import { UsersModule } from './modules/users/users.module';
import { WorkAssignmentsModule } from './modules/work-assignments/work-assignments.module';
import { WorkOrdersModule } from './modules/work-orders/work-orders.module';
import { WorkPhotosModule } from './modules/work-photos/work-photos.module';
import { QueuesModule } from './queues/queues.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      cache: true,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    HousekeepingModule,
    WorkersModule,
    AuditModule,
    SettingsModule,
    SequenceModule,
    RedisModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
    }),
    AuthModule,
    AttendanceModule,
    HealthModule,
    QueuesModule,
    UsersModule,
    CustomersModule,
    DashboardModule,
    EmployeesModule,
    ManagersModule,
    ServiceCategoriesModule,
    ServicesModule,
    EnquiriesModule,
    ExportsModule,
    BookingsModule,
    WorkOrdersModule,
    WorkAssignmentsModule,
    ServiceReportsModule,
    NotificationsModule,
    OvertimeModule,
    LeaveModule,
    MaintenanceModule,
    WorkPhotosModule,
    UploadsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*splat');
  }
}

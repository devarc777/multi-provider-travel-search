import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly requiredRole:
      | 'VENDOR'
      | 'CUSTOMER'
      | 'ORGANIZER'
      | 'ADMIN',
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user as { id: string; role?: string } | undefined;
    if (!user) throw new UnauthorizedException('Unauthorized');
    if (user.role !== this.requiredRole)
      throw new ForbiddenException('Insufficient role');
    return true;
  }
}

export function VendorOnly(): RolesGuard {
  return new RolesGuard('VENDOR');
}

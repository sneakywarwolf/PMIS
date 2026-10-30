import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';

const MAX_CONCURRENT_UPLOADS = 2;
let active = 0;

/**
 * Takes one of a few upload slots BEFORE the file is received (a guard runs ahead of the upload handling), and gives it
 * back when the response is finished or the connection drops. A burst of large Fortify uploads is refused up front
 * instead of each one being buffered in memory first.
 */
@Injectable()
export class FortifySlotGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (active >= MAX_CONCURRENT_UPLOADS) {
      throw new HttpException('Other Fortify files are being uploaded or processed right now. Please try again in a minute.', 429);
    }
    active++;
    const res = context.switchToHttp().getResponse();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
    };
    res.once('finish', release);
    res.once('close', release);
    return true;
  }
}

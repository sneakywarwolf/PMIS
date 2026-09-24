import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { authenticateSocket } from '../auth/verify-access-token';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/dashboard',
})
export class DashboardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
    private prismaService: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    const user = await authenticateSocket(client.handshake.headers.cookie, this.jwtService, this.redisService, this.prismaService);
    if (!user) {
      client.disconnect(true);
      return;
    }
    client.data.user = user;
  }

  handleDisconnect() {}

  @SubscribeMessage('join_team_room')
  handleJoinTeamRoom(@ConnectedSocket() client: Socket, @MessageBody() tlId: unknown) {
    const user = client.data.user;
    if (!user || typeof tlId !== 'string') return;
    if (user.role !== 'ADMIN' && user.id !== tlId && user.assignedTlId !== tlId) return;
    client.join(`team_${tlId}`);
  }

  @SubscribeMessage('leave_team_room')
  handleLeaveTeamRoom(@ConnectedSocket() client: Socket, @MessageBody() tlId: unknown) {
    if (typeof tlId === 'string') client.leave(`team_${tlId}`);
  }

  broadcastTeamUpdate(tlId: string, data: any) {
    this.server.to(`team_${tlId}`).emit('team_update', data);
  }

  broadcastProjectUpdate(projectId: string, data: any) {
    this.server.to(`project_${projectId}`).emit('project_update', data);
  }
}

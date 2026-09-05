import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

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

  private readonly logger = new Logger(DashboardGateway.name);

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.cookie;
      if (!token) {
        client.disconnect();
        return;
      }
      this.logger.log(`Client connected: ${client.id}`);
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_team_room')
  handleJoinTeamRoom(client: Socket, tlId: string) {
    client.join(`team_${tlId}`);
    this.logger.log(`Client ${client.id} joined team room: ${tlId}`);
  }

  @SubscribeMessage('leave_team_room')
  handleLeaveTeamRoom(client: Socket, tlId: string) {
    client.leave(`team_${tlId}`);
    this.logger.log(`Client ${client.id} left team room: ${tlId}`);
  }

  // Method to broadcast updates to team rooms
  broadcastTeamUpdate(tlId: string, data: any) {
    this.server.to(`team_${tlId}`).emit('team_update', data);
  }

  broadcastProjectUpdate(projectId: string, data: any) {
    this.server.to(`project_${projectId}`).emit('project_update', data);
  }
}

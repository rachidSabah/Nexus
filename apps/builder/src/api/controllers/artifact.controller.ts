import { FastifyReply, FastifyRequest } from 'fastify';
import {
  IDownloadArtifactUseCase,
  IListArtifactsUseCase,
} from '../../domain/ports/inbound/build-use-cases.js';

export class ArtifactController {
  constructor(
    private readonly listArtifactsUseCase: IListArtifactsUseCase,
    private readonly downloadArtifactUseCase: IDownloadArtifactUseCase
  ) {}

  public listByBuildId = async (
    request: FastifyRequest<{ Params: { buildId: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { buildId } = request.params;
    const artifacts = await this.listArtifactsUseCase.execute(buildId);
    reply.status(200).send({
      success: true,
      data: artifacts.map((a) => a.toJSON()),
      total: artifacts.length,
    });
  };

  public download = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { id } = request.params;
    const { artifact, stream } = await this.downloadArtifactUseCase.execute(id);

    reply.header('Content-Type', artifact.mimeType || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${artifact.name}"`);
    if (artifact.sizeBytes > 0) {
      reply.header('Content-Length', artifact.sizeBytes);
    }
    return reply.send(stream);
  };
}

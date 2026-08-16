import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '../../domain/errors/domain-error.js';

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply
): void {
  if (error instanceof DomainError) {
    reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.errorCode,
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }

  const statusCode = (error as FastifyError).statusCode || 500;
  reply.status(statusCode).send({
    success: false,
    error: {
      code: statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR',
      message: error.message || 'An unexpected error occurred',
    },
  });
}

import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiExtraModels } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Turn a zod schema into a Swagger `@ApiBody` decorator. Request bodies in
 * this codebase are validated with zod (see `parseBody` / `CreateMatchDto`,
 * etc.) and the handlers accept `@Body() body: unknown`, so Nest's default
 * schema inference renders them as empty in Swagger. This helper bridges
 * the gap without forcing a migration to class-based DTOs.
 *
 * The emitted schema is inlined per-endpoint (no `$ref`s) so the Swagger UI
 * renders fully without a shared component registry — keeps the wiring flat
 * and avoids name collisions across feature modules.
 */
export function ZodBody(schema: ZodTypeAny, description?: string) {
  // `zodToJsonSchema`'s return type is a discriminated union keyed on the
  // `target` option, which triggers TS2589 ("type instantiation excessively
  // deep") when the caller passes options inline. Cast the input through
  // `any` to collapse that inference — the runtime shape is identical.
  const jsonSchema = zodToJsonSchema(schema as any, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as SchemaObject;
  return applyDecorators(
    ApiExtraModels(),
    ApiBody({ description, schema: jsonSchema }),
  );
}

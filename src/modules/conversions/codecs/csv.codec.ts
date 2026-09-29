import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { parse as parseCsv } from 'csv-parse';
import { stringify as stringifyCsv } from 'csv-stringify';

import { ConversionErrorCode, TextFormat } from '../conversions.constants';
import { CodecError } from './codec-error';
import { FormatCodec, Intermediate } from './format-codec';

type Row = Record<string, unknown>;

/**
 * CSV codec (RFC 4180) built on the streaming APIs of csv-parse / csv-stringify.
 *
 * Mapping rules (documented, implementation-defined): CSV is tabular, so its
 * intermediate representation is an **array of flat objects** keyed by the
 * header row; all cell values are strings. Converting TO CSV therefore
 * requires data that reduces to such an array:
 *  - single-key wrapper objects are unwrapped first, so XML-shaped data such as
 *    `{people: {person: [{...}, {...}]}}` yields the `person` rows;
 *  - a single flat object is treated as one row;
 *  - any nested value (object or array in a cell) is rejected with NOT_TABULAR.
 * The header is the ordered union of keys of all rows.
 */
export class CsvCodec extends FormatCodec {
  readonly format = TextFormat.CSV;

  async parse(input: AsyncIterable<string>): Promise<Intermediate> {
    const rows: Row[] = [];
    try {
      await pipeline(
        input,
        parseCsv({
          columns: true,
          skip_empty_lines: true,
          bom: true,
          trim: true,
        }),
        async (records: AsyncIterable<Row>) => {
          for await (const record of records) {
            rows.push(record);
          }
        },
      );
    } catch (err) {
      if (err instanceof CodecError) {
        throw err;
      }
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        `Invalid CSV: ${(err as Error).message}`,
      );
    }
    return rows;
  }

  serialize(data: Intermediate): Readable {
    const rows = this.toRows(data);
    const columns = this.unionColumns(rows);
    if (columns.length === 0) {
      return Readable.from([]);
    }
    return Readable.from(rows).pipe(
      stringifyCsv({
        header: true,
        columns,
        // csv-stringify defaults: true → "1", false → "", Date → epoch ms.
        cast: {
          boolean: (value) => String(value),
          date: (value) => value.toISOString(),
        },
      }),
    );
  }

  /** Normalizes the intermediate representation to an array of flat rows. */
  private toRows(data: Intermediate): Row[] {
    const table = unwrapSingleKey(data);
    const array = Array.isArray(table) ? table : [table];
    return array.map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new CodecError(
          ConversionErrorCode.NOT_TABULAR,
          'CSV output requires an array of flat objects',
        );
      }
      const row = entry as Row;
      for (const value of Object.values(row)) {
        if (
          value !== null &&
          typeof value === 'object' &&
          !(value instanceof Date)
        ) {
          throw new CodecError(
            ConversionErrorCode.NOT_TABULAR,
            'CSV cells cannot contain nested objects or arrays',
          );
        }
      }
      return row;
    });
  }

  /** Ordered union of keys across all rows for a stable header. */
  private unionColumns(rows: Row[]): string[] {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        seen.add(key);
      }
    }
    return [...seen];
  }
}

/** Descends through `{key: <object|array>}` wrappers down to the table. */
function unwrapSingleKey(data: Intermediate): Intermediate {
  let current = data;
  while (
    current !== null &&
    typeof current === 'object' &&
    !Array.isArray(current) &&
    !(current instanceof Date)
  ) {
    const values = Object.values(current as Row);
    const only = values[0];
    if (
      values.length !== 1 ||
      only === null ||
      typeof only !== 'object' ||
      only instanceof Date
    ) {
      break;
    }
    current = only;
  }
  return current;
}

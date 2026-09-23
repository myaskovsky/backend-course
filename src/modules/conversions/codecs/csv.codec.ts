import { Injectable } from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';

import { ConversionErrorCode, TextFormat } from '../conversions.constants';
import { CodecError } from './codec-error';
import { FormatCodec, Intermediate } from './format-codec';

type Row = Record<string, unknown>;

/**
 * CSV codec (RFC 4180) built on csv-parse / csv-stringify.
 *
 * Mapping rules (documented, implementation-defined): CSV is tabular, so its
 * intermediate representation is an **array of flat objects** keyed by the
 * header row. Converting TO CSV therefore requires data that reduces to such an
 * array — a single flat object is treated as one row; any nested value (object
 * or array in a cell) is rejected with NOT_TABULAR.
 */
@Injectable()
export class CsvCodec extends FormatCodec {
  readonly format = TextFormat.CSV;
  readonly contentType = 'text/csv; charset=utf-8';
  readonly extension = 'csv';

  parse(input: string): Intermediate {
    try {
      return parseCsv(input, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true,
      });
    } catch (err) {
      throw new CodecError(
        ConversionErrorCode.INVALID_SYNTAX,
        `Invalid CSV: ${(err as Error).message}`,
      );
    }
  }

  serialize(data: Intermediate): string {
    const rows = this.toRows(data);
    const columns = this.unionColumns(rows);
    return stringifyCsv(rows, { header: true, columns });
  }

  /** Normalizes the intermediate representation to an array of flat rows. */
  private toRows(data: Intermediate): Row[] {
    const array = Array.isArray(data) ? data : [data];
    if (array.length === 0) {
      return [];
    }
    return array.map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new CodecError(
          ConversionErrorCode.NOT_TABULAR,
          'CSV output requires an array of flat objects',
        );
      }
      const row = entry as Row;
      for (const value of Object.values(row)) {
        if (value !== null && typeof value === 'object') {
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

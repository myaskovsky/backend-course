import { ConversionErrorCode } from '../conversions.constants';
import { CodecError } from './codec-error';
import { CsvCodec } from './csv.codec';
import { assertWithinDepth } from './depth-guard';
import { JsonCodec } from './json.codec';
import { XmlCodec } from './xml.codec';
import { YamlCodec } from './yaml.codec';

const json = new JsonCodec();
const yaml = new YamlCodec();
const xml = new XmlCodec();
const csv = new CsvCodec();

describe('JsonCodec', () => {
  it('round-trips an object', () => {
    const value = { name: 'Ann', tags: ['a', 'b'], age: 30 };
    expect(json.parse(json.serialize(value))).toEqual(value);
  });

  it('throws INVALID_SYNTAX on malformed input', () => {
    expect(() => json.parse('{bad')).toThrow(CodecError);
    try {
      json.parse('{bad');
    } catch (err) {
      expect((err as CodecError).code).toBe(ConversionErrorCode.INVALID_SYNTAX);
    }
  });
});

describe('YamlCodec', () => {
  it('is a direct mapping with JSON', () => {
    const ir = json.parse('{"a":1,"b":["x","y"]}');
    const yamlText = yaml.serialize(ir);
    expect(yaml.parse(yamlText)).toEqual(ir);
  });

  it('normalizes an empty document to null', () => {
    expect(yaml.parse('')).toBeNull();
  });

  it('throws INVALID_SYNTAX on malformed YAML', () => {
    expect(() => yaml.parse('a:\n  - b\n -c')).toThrow(CodecError);
  });
});

describe('XmlCodec', () => {
  it('surfaces attributes and repeated elements', () => {
    const ir = xml.parse('<root><a>1</a><a>2</a><b x="y">t</b></root>') as {
      root: { a: number[]; b: { '#text': string; '@_x': string } };
    };
    expect(ir.root.a).toEqual([1, 2]);
    expect(ir.root.b['@_x']).toBe('y');
  });

  it('wraps arrays and multi-key objects under a single root', () => {
    expect(xml.serialize([1, 2])).toContain('<root>');
    expect(xml.serialize([1, 2])).toContain('<item>1</item>');
  });

  it('emits a declaration and a single-key root directly', () => {
    const out = xml.serialize({ person: { name: 'Ann' } });
    expect(out.startsWith('<?xml')).toBe(true);
    expect(out).toContain('<person>');
  });

  it('rejects a DOCTYPE (XXE / entity-expansion defense)', () => {
    const payload =
      '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>';
    try {
      xml.parse(payload);
      fail('expected rejection');
    } catch (err) {
      expect((err as CodecError).code).toBe(ConversionErrorCode.INVALID_SYNTAX);
    }
  });
});

describe('CsvCodec', () => {
  it('parses a header row into an array of objects', () => {
    expect(csv.parse('name,age\nAnn,30\nBob,25\n')).toEqual([
      { name: 'Ann', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
  });

  it('strips a BOM before parsing', () => {
    const rows = csv.parse('﻿name\nAnn\n') as Array<Record<string, string>>;
    expect(Object.keys(rows[0])).toEqual(['name']);
  });

  it('serializes an array of flat objects with a union header', () => {
    const out = csv.serialize([{ a: 1 }, { a: 2, b: 3 }]);
    expect(out).toContain('a,b');
  });

  it('rejects non-tabular data with NOT_TABULAR', () => {
    try {
      csv.serialize([{ a: { nested: 1 } }]);
      fail('expected rejection');
    } catch (err) {
      expect((err as CodecError).code).toBe(ConversionErrorCode.NOT_TABULAR);
    }
  });
});

describe('assertWithinDepth', () => {
  it('accepts structures within the limit', () => {
    expect(() => assertWithinDepth({ a: { b: 1 } }, 5)).not.toThrow();
  });

  it('rejects structures deeper than the limit', () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    try {
      assertWithinDepth(deep, 2);
      fail('expected rejection');
    } catch (err) {
      expect((err as CodecError).code).toBe(ConversionErrorCode.DEPTH_EXCEEDED);
    }
  });
});

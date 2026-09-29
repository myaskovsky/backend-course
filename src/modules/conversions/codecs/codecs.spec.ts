import { Readable } from 'node:stream';

import * as yaml from 'js-yaml';

import { ConversionErrorCode, TextFormat } from '../conversions.constants';
import { CodecError } from './codec-error';
import { getCodec } from './codec.registry';
import { CsvCodec } from './csv.codec';
import { assertWithinDepth } from './depth-guard';
import { FormatCodec } from './format-codec';
import { JsonCodec } from './json.codec';
import { Utf8DecodeStream } from './utf8-decode.stream';
import { XmlCodec } from './xml.codec';
import { YamlCodec } from './yaml.codec';

const json = new JsonCodec();
const yamlCodec = new YamlCodec();
const xml = new XmlCodec();
const csv = new CsvCodec();

/** Feeds text to a codec as several chunks, like a file read from disk. */
function chunks(...parts: string[]): AsyncIterable<string> {
  return Readable.from(parts);
}

/** Splits text into chunks of `size` characters. */
function split(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

async function collect(stream: Readable): Promise<string> {
  let out = '';
  for await (const chunk of stream) {
    out += String(chunk);
  }
  return out;
}

const parse = (codec: FormatCodec, text: string, maxDepth = 100) =>
  codec.parse(chunks(...split(text, 3)), { maxDepth });

async function expectCode(
  promise: Promise<unknown>,
  code: ConversionErrorCode,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(CodecError);
  await promise.catch((err: CodecError) => expect(err.code).toBe(code));
}

describe('getCodec', () => {
  it.each(Object.values(TextFormat))('returns the %s codec', (format) => {
    expect(getCodec(format).format).toBe(format);
  });
});

describe('Utf8DecodeStream', () => {
  const decode = (...buffers: Buffer[]) =>
    collect(Readable.from(buffers).pipe(new Utf8DecodeStream()));

  it('reassembles a multi-byte character split across chunks', async () => {
    const bytes = Buffer.from('жук', 'utf8'); // 2 bytes per letter
    await expect(
      decode(bytes.subarray(0, 1), bytes.subarray(1, 3), bytes.subarray(3)),
    ).resolves.toBe('жук');
  });

  it('drops a leading BOM', async () => {
    await expect(decode(Buffer.from('\uFEFFname', 'utf8'))).resolves.toBe(
      'name',
    );
  });

  it('rejects invalid UTF-8 with INVALID_ENCODING', async () => {
    await expectCode(
      decode(Buffer.from([0x61, 0xff, 0x62])),
      ConversionErrorCode.INVALID_ENCODING,
    );
  });

  it('rejects a truncated multi-byte sequence at the end', async () => {
    await expectCode(
      decode(Buffer.from([0xd0])),
      ConversionErrorCode.INVALID_ENCODING,
    );
  });
});

describe('JsonCodec', () => {
  const sample = {
    name: 'Ann',
    tags: ['a', 'b'],
    age: 30,
    nested: { empty: {}, list: [], flag: false, none: null, pi: 3.14 },
    unicode: 'жук "quoted" \\ /',
  };

  it('parses a document fed in small chunks', async () => {
    await expect(parse(json, JSON.stringify(sample))).resolves.toEqual(sample);
  });

  it('parses top-level primitives', async () => {
    await expect(parse(json, '"str"')).resolves.toBe('str');
    await expect(parse(json, '-1.5e3')).resolves.toBe(-1500);
    await expect(parse(json, 'null')).resolves.toBeNull();
  });

  it('keeps a __proto__ key as an own property (like JSON.parse)', async () => {
    const result = (await parse(json, '{"__proto__":{"x":1}}')) as Record<
      string,
      unknown
    >;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it.each([['{bad'], ['{"a":1'], ['   '], ['[1,2] trailing'], ['{} {}']])(
    'rejects malformed input %j with INVALID_SYNTAX',
    async (input) => {
      await expectCode(parse(json, input), ConversionErrorCode.INVALID_SYNTAX);
    },
  );

  it('aborts on excessive nesting with DEPTH_EXCEEDED', async () => {
    await expectCode(
      parse(json, '[[[[1]]]]', 3),
      ConversionErrorCode.DEPTH_EXCEEDED,
    );
    await expect(parse(json, '[[[1]]]', 3)).resolves.toEqual([[[1]]]);
  });

  it('serializes exactly like JSON.stringify(data, null, 2)', async () => {
    const withEdgeCases = {
      ...sample,
      date: new Date('2026-01-01T00:00:00Z'),
      skipped: undefined,
      arr: [undefined, NaN, Infinity, 1],
    };
    await expect(collect(json.serialize(withEdgeCases))).resolves.toBe(
      `${JSON.stringify(withEdgeCases, null, 2)}\n`,
    );
    await expect(collect(json.serialize('x'))).resolves.toBe('"x"\n');
    await expect(collect(json.serialize(undefined))).resolves.toBe('null\n');
  });

  it('streams large arrays in several chunks', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: i, v: 'x' }));
    const stream = json.serialize(rows);
    let count = 0;
    let text = '';
    for await (const chunk of stream) {
      count++;
      text += String(chunk);
    }
    expect(count).toBeGreaterThan(1);
    expect(JSON.parse(text)).toEqual(rows);
  });
});

describe('YamlCodec', () => {
  it('is a direct mapping with JSON', async () => {
    const ir = { a: 1, b: ['x', 'y'], c: { d: null } };
    const yamlText = await collect(yamlCodec.serialize(ir));
    await expect(parse(yamlCodec, yamlText)).resolves.toEqual(ir);
  });

  it('streams per top-level entry with the same result as a single dump', async () => {
    const list = [{ a: 1 }, { b: [1, 2] }, 'x'];
    const map = { a: 1, b: { c: [1, 2] }, d: 'x' };
    const options = { noRefs: true, lineWidth: -1 };
    await expect(collect(yamlCodec.serialize(list))).resolves.toBe(
      yaml.dump(list, options),
    );
    await expect(collect(yamlCodec.serialize(map))).resolves.toBe(
      yaml.dump(map, options),
    );
    await expect(collect(yamlCodec.serialize([]))).resolves.toBe('[]\n');
    await expect(collect(yamlCodec.serialize(null))).resolves.toBe('null\n');
  });

  it('normalizes an empty document to null', async () => {
    await expect(parse(yamlCodec, '')).resolves.toBeNull();
    await expect(parse(yamlCodec, '  \n ')).resolves.toBeNull();
  });

  it('throws INVALID_SYNTAX on malformed YAML', async () => {
    await expectCode(
      parse(yamlCodec, 'a:\n  - b\n -c'),
      ConversionErrorCode.INVALID_SYNTAX,
    );
  });

  it('rejects excessive nesting with DEPTH_EXCEEDED', async () => {
    await expectCode(
      parse(yamlCodec, 'a:\n  b:\n    c:\n      d: 1\n', 2),
      ConversionErrorCode.DEPTH_EXCEEDED,
    );
  });
});

describe('XmlCodec', () => {
  it('surfaces attributes, text and repeated elements', async () => {
    const ir = await parse(
      xml,
      '<?xml version="1.0"?><root><a>1</a><a>2</a><b x="y">t</b><c/></root>',
    );
    expect(ir).toEqual({
      root: { a: [1, 2], b: { '@_x': 'y', '#text': 't' }, c: '' },
    });
  });

  it('decodes entities and CDATA, ignores comments and PIs', async () => {
    const ir = await parse(
      xml,
      '<r a="1&amp;2"><?pi x?><!-- c --><t>x &lt; y</t><d><![CDATA[<z>]]></d></r>',
    );
    expect(ir).toEqual({ r: { '@_a': '1&2', t: 'x < y', d: '<z>' } });
  });

  it('coerces only exact JSON numbers and booleans', async () => {
    const ir = await parse(
      xml,
      '<r><a>007</a><b>1.5</b><c>true</c><d>1e</d><e>-2</e><f>12345678901234567890</f></r>',
    );
    expect(ir).toEqual({
      r: {
        a: '007',
        b: 1.5,
        c: true,
        d: '1e',
        e: -2,
        f: '12345678901234567890',
      },
    });
  });

  it('keeps a __proto__ element as an own property', async () => {
    const ir = (await parse(xml, '<r><__proto__>1</__proto__></r>')) as {
      r: Record<string, unknown>;
    };
    expect(Object.getPrototypeOf(ir.r)).toBe(Object.prototype);
    expect(Object.keys(ir.r)).toEqual(['__proto__']);
  });

  it('rejects a DOCTYPE (XXE / entity-expansion defense)', async () => {
    await expectCode(
      parse(
        xml,
        '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>',
      ),
      ConversionErrorCode.INVALID_SYNTAX,
    );
  });

  it.each([['<a><b></a>'], [''], ['<a/><b/>'], ['<a>&undefined;</a>']])(
    'rejects malformed XML %j with INVALID_SYNTAX',
    async (input) => {
      await expectCode(parse(xml, input), ConversionErrorCode.INVALID_SYNTAX);
    },
  );

  it('aborts on excessive nesting with DEPTH_EXCEEDED', async () => {
    await expectCode(
      parse(xml, '<a><b><c><d>1</d></c></b></a>', 3),
      ConversionErrorCode.DEPTH_EXCEEDED,
    );
  });

  it('wraps arrays and multi-key objects under a single root', async () => {
    const out = await collect(xml.serialize([1, 2]));
    expect(out).toContain('<root>');
    expect(out).toContain('<item>1</item>');
    expect(await collect(xml.serialize({ a: 1, b: 2 }))).toContain('<root>');
  });

  it('emits a declaration and a single-key root directly', async () => {
    const out = await collect(xml.serialize({ person: { name: 'Ann' } }));
    expect(out.startsWith('<?xml')).toBe(true);
    expect(out).toContain('<person>');
    expect(out).toContain('  <name>Ann</name>');
  });

  it('writes an object in an attribute slot as JSON', async () => {
    const out = await collect(xml.serialize({ doc: { '@_meta': { a: 1 } } }));
    expect(out).toContain('<doc meta="{&quot;a&quot;:1}"></doc>');
  });

  it('escapes text/attributes and sanitizes invalid element names', async () => {
    const out = await collect(
      xml.serialize({
        doc: { '@_q': 'a"b', 'first name': 'x < y & z', '1st': 1 },
      }),
    );
    expect(out).toContain('<doc q="a&quot;b">');
    expect(out).toContain('<first_name>x &lt; y &amp; z</first_name>');
    expect(out).toContain('<_1st>1</_1st>');
  });

  it('round-trips through its own IR', async () => {
    const source =
      '<catalog><book id="1"><title>A &amp; B</title><tag>x</tag><tag>y</tag></book></catalog>';
    const ir = await parse(xml, source);
    const again = await parse(xml, await collect(xml.serialize(ir)));
    expect(again).toEqual(ir);
  });
});

describe('CsvCodec', () => {
  it('parses a header row into an array of objects, across chunks', async () => {
    await expect(parse(csv, 'name,age\nAnn,30\nBob,25\n')).resolves.toEqual([
      { name: 'Ann', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
  });

  it('handles quoted fields with delimiters and newlines', async () => {
    await expect(parse(csv, 'a,b\n"x,1","line\nbreak"\n')).resolves.toEqual([
      { a: 'x,1', b: 'line\nbreak' },
    ]);
  });

  it('throws INVALID_SYNTAX on inconsistent rows', async () => {
    await expectCode(
      parse(csv, 'a,b\n1,2,3\n'),
      ConversionErrorCode.INVALID_SYNTAX,
    );
  });

  it('serializes an array of flat objects with a union header', async () => {
    const out = await collect(csv.serialize([{ a: 1 }, { a: 2, b: 3 }]));
    expect(out).toBe('a,b\n1,\n2,3\n');
  });

  it('writes booleans and dates readably', async () => {
    const out = await collect(
      csv.serialize([
        { ok: true, no: false, at: new Date('2026-01-01T00:00:00Z') },
      ]),
    );
    expect(out).toBe('ok,no,at\ntrue,false,2026-01-01T00:00:00.000Z\n');
  });

  it('unwraps single-key wrappers down to the rows', async () => {
    await expect(
      collect(csv.serialize({ data: { rows: [{ a: 1 }, { a: 2 }] } })),
    ).resolves.toBe('a\n1\n2\n');
    await expect(collect(csv.serialize({ item: { a: 1 } }))).resolves.toBe(
      'a\n1\n',
    );
  });

  it('treats a single flat object as one row and [] as empty output', async () => {
    await expect(collect(csv.serialize({ a: 1 }))).resolves.toBe('a\n1\n');
    await expect(collect(csv.serialize([]))).resolves.toBe('');
  });

  it('rejects non-tabular data with NOT_TABULAR', () => {
    for (const data of [[{ a: { nested: 1 } }], [1, 2], 'text', [[1]]]) {
      try {
        csv.serialize(data);
        fail('expected rejection');
      } catch (err) {
        expect((err as CodecError).code).toBe(ConversionErrorCode.NOT_TABULAR);
      }
    }
  });
});

describe('cross-format conversions', () => {
  const convert = async (
    from: FormatCodec,
    to: FormatCodec,
    input: string,
  ): Promise<string> => collect(to.serialize(await parse(from, input)));

  it('XML → CSV for a list of flat records', async () => {
    const out = await convert(
      xml,
      csv,
      '<people><person><name>Ann</name><age>30</age></person><person><name>Bob</name><age>25</age></person></people>',
    );
    // {people: {person: [...]}} — the single-key wrappers are unwrapped.
    expect(out).toBe('name,age\nAnn,30\nBob,25\n');
  });

  it('YAML → XML', async () => {
    const out = await convert(
      yamlCodec,
      xml,
      'person:\n  name: Ann\n  tags: [a, b]\n',
    );
    expect(out).toContain('<person>');
    expect(out).toContain('<tags>a</tags>');
    expect(out).toContain('<tags>b</tags>');
  });

  it('CSV → YAML', async () => {
    const out = await convert(csv, yamlCodec, 'a,b\n1,2\n');
    expect(yaml.load(out)).toEqual([{ a: '1', b: '2' }]);
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

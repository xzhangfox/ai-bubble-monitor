import fs from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const check = process.argv.includes('--check')
let sections

for (const lang of ['en', 'zh']) {
  const content = JSON.parse(await fs.readFile(new URL(`content/documentation.${lang}.json`, root), 'utf8'))
  const ids = content.sections.map((section) => section.id)
  if (new Set(ids).size !== ids.length || (sections && JSON.stringify(sections) !== JSON.stringify(ids))) {
    throw new Error(`Documentation section IDs must be unique and match in both languages: ${lang}`)
  }
  sections = ids
  const lines = [`<!-- Generated from content/documentation.${lang}.json. Run npm run docs:build after editing. -->`, '', `# ${content.title}`, '', content.subtitle, '']
  const paragraphs = (values = []) => values.forEach((value) => lines.push(value, ''))
  const cell = (value) => value.replaceAll('|', '\\|').replaceAll('\n', ' ')

  for (const section of content.sections) {
    lines.push(`## ${section.title}`, '', section.summary, '')
    if (section.id === 'evaluation') paragraphs(section.paragraphs)
    if (section.table) {
      const { columns, rows } = section.table
      if (rows.some((row) => row.length !== columns.length)) throw new Error(`Invalid table: ${lang}/${section.id}`)
      lines.push(`| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`)
      rows.forEach((row) => lines.push(`| ${row.map(cell).join(' | ')} |`))
      lines.push('')
    }
    if (section.id !== 'evaluation') paragraphs(section.paragraphs)
    if (section.details) {
      lines.push(`### ${section.details.title}`, '')
      paragraphs(section.details.paragraphs)
    }
    paragraphs(section.paragraphsAfter)
    if (section.links) {
      section.links.forEach(({ label, url }) => lines.push(`- [${label}](${url})`))
      lines.push('')
    }
  }

  const output = new URL(`docs/methodology.${lang}.md`, root)
  const markdown = `${lines.join('\n').trimEnd()}\n`
  if (check) {
    const existing = await fs.readFile(output, 'utf8').catch(() => '')
    if (existing.replaceAll('\r\n', '\n') !== markdown) throw new Error(`Documentation is stale: docs/methodology.${lang}.md. Run npm run docs:build.`)
  } else {
    await fs.mkdir(new URL('docs/', root), { recursive: true })
    await fs.writeFile(output, markdown)
  }
}

console.log(check ? 'Bilingual documentation is up to date.' : 'Generated English and Chinese methodology documents.')

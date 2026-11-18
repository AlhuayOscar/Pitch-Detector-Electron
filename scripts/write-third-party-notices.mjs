import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootManifest = fileURLToPath(new URL('../package.json', import.meta.url));
const rendererPackages = ['@tensorflow/tfjs', 'd3', 'lucide-solid', 'solid-js', 'tailwindcss'];
const noticeFilePattern = /^(?:licen[cs]e|notice|copying)(?:$|[._-])/i;
const seen = new Set();
const sections = [];

function collect(name, importer, optional = false) {
    const packageManifest = createRequire(importer).resolve.paths(`${name}/package.json`)
        ?.map(directory => join(directory, name, 'package.json'))
        .find(existsSync);

    if (!packageManifest) {
        if (optional) return;
        throw new Error(`No se encontró el paquete ${name}. Ejecuta npm ci antes de compilar.`);
    }

    const manifestPath = realpathSync(packageManifest);
    if (seen.has(manifestPath)) return;
    seen.add(manifestPath);

    const directory = dirname(manifestPath);
    const metadata = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const label = `${metadata.name} ${metadata.version}`;
    const files = readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile() && noticeFilePattern.test(entry.name))
        .map(entry => entry.name)
        .sort();

    const license = metadata.license?.type ?? metadata.license ?? '';
    const contents = [label, license, ...files.map(file => `${file}\n${readFileSync(join(directory, file), 'utf8').trimEnd()}`)];
    if (name === 'seedrandom' && files.length === 0) {
        const source = readFileSync(join(directory, 'seedrandom.js'), 'utf8');
        const licenseComment = source.match(/^\/\*([\s\S]*?)\*\//);
        if (licenseComment) contents.push(licenseComment[1].trim());
    }
    sections.push({ label, text: contents.filter(Boolean).join('\n\n') });

    const optionalDependencies = metadata.optionalDependencies ?? {};
    const dependencies = { ...metadata.dependencies, ...optionalDependencies };
    for (const dependency of Object.keys(dependencies)) {
        collect(dependency, manifestPath, Object.hasOwn(optionalDependencies, dependency));
    }
}

for (const name of rendererPackages) collect(name, rootManifest);

const header = 'Pitch Detector\nLicencias de bibliotecas de terceros';
const notices = sections.sort((a, b) => a.label.localeCompare(b.label)).map(section => section.text);
const tensorflowLicense = readFileSync(new URL('./tensorflow-js-license.txt', import.meta.url), 'utf8').trim();
notices.push(`TensorFlow.js\n\n${tensorflowLicense}`);
writeFileSync(new URL('../dist/THIRD-PARTY.txt', import.meta.url), `${[header, ...notices].join('\n\n---\n\n')}\n`, 'utf8');

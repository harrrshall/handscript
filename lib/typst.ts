import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { uploadFile, getDownloadUrl } from '@/lib/s3';

import os from 'os';

const execPromise = util.promisify(exec);

const TYPST_TEMPLATE_DIR = path.join(process.cwd(), 'typst');
const TEMP_DIR = path.join(os.tmpdir(), 'handscript-typst');

function ensureTempDir() {
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
}

export async function renderMarkdownToPdf(markdownFiles: string[], jobId: string): Promise<string> {
    // Legacy or unused placeholder. 
    // If used, it should concatenate content.
    // But since we are using Typst code now, simple concatenation works 
    // if the code fragments are block-level.
    return "";
}

export async function compileTypst(typstContent: string, jobId: string): Promise<string> {
    ensureTempDir();
    const jobDir = path.join(TEMP_DIR, jobId);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    const templatePath = path.join(TYPST_TEMPLATE_DIR, 'knowtube-academic.typ');
    const jobTemplatePath = path.join(jobDir, 'main.typ');

    // Read template
    const template = fs.readFileSync(templatePath, 'utf8');

    // Write combined file
    fs.writeFileSync(jobTemplatePath, template + '\n' + typstContent);

    try {
        const { stdout, stderr } = await execPromise(`typst compile main.typ output.pdf`, {
            cwd: jobDir
        });

        console.log('Typst stdout:', stdout);
        if (stderr) console.error('Typst stderr:', stderr);

        const pdfPath = path.join(jobDir, 'output.pdf');
        if (!fs.existsSync(pdfPath)) {
            throw new Error('PDF output not found after compilation');
        }

        const pdfBuffer = fs.readFileSync(pdfPath);
        // uploadFile returns key
        const key = await uploadFile(`${jobId}.pdf`, pdfBuffer, 'application/pdf');
        // generate signed url
        const pdfUrl = await getDownloadUrl(key);

        // Cleanup
        // fs.rmSync(jobDir, { recursive: true, force: true });

        return pdfUrl;

    } catch (error) {
        console.error('Typst compilation failed:', error);
        throw error;
    }
}

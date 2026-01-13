import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { uploadFile } from './blob';

const execPromise = util.promisify(exec);

const TYPST_TEMPLATE_DIR = path.join(process.cwd(), 'typst');
const TEMP_DIR = path.join(process.cwd(), 'tmp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export async function renderMarkdownToPdf(markdownFiles: string[], jobId: string): Promise<string> {
    // 1. Create a combined markdown file
    const combinedMarkdownPath = path.join(TEMP_DIR, `${jobId}-content.md`);
    const finalPdfPath = path.join(TEMP_DIR, `${jobId}.pdf`);

    // Combine all markdown content
    // Assuming markdownFiles serves as array of markdown strings or paths. 
    // Design says "Fetch assembled Markdown from Blob", so likely we get one large string or URL.
    // Let's assume for this function we get the raw markdown string.

    // Wait, the input signature should probably be the markdown content itself.
    // Retrying the signature to match usual flow.
    return "" // Placeholder, see logic below
}

export async function compileTypst(markdownContent: string, jobId: string): Promise<string> {
    const contentPath = path.join(TYPST_TEMPLATE_DIR, 'content.md'); // Typst template will read from here? 
    // Actually, parallel concurrent requests might race if we use a fixed filename in the same dir.
    // Better to generate a unique directory for each compile job or use unique filenames and pass them to typst.

    // Typst 0.12 lets us pass inputs via CLI, but standard way is `typst compile main.typ`
    // We can copy the template to a temp dir along with the content.

    const jobDir = path.join(TEMP_DIR, jobId);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    const templatePath = path.join(TYPST_TEMPLATE_DIR, 'knowtube-academic.typ');
    const jobTemplatePath = path.join(jobDir, 'main.typ');
    const jobContentPath = path.join(jobDir, 'content.md');

    // Write content
    fs.writeFileSync(jobContentPath, markdownContent);

    // Copy template (or we could just reference it if it doesn't need to be in same dir, strictly speaking)
    // But typst imports might be relative. Let's copy to be safe.
    fs.copyFileSync(templatePath, jobTemplatePath);

    // We also need dependencies.
    // If the template imports system packages (@preview/...), they should be downloaded by Typst automatically.

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
        const pdfUrl = await uploadFile(pdfBuffer, `${jobId}.pdf`);

        // Cleanup
        // fs.rmSync(jobDir, { recursive: true, force: true });

        return pdfUrl;
    } catch (error) {
        console.error('Typst compilation failed:', error);
        throw error;
    }
}

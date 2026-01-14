
import 'dotenv/config';
import { uploadFile, deleteFile, listFiles, getDownloadUrl } from '../lib/s3';
import { notDeepEqual } from 'assert';

async function main() {
    console.log("Starting B2 End-to-End Test (Private Bucket)...");

    // Debug environment
    console.log("B2_ENDPOINT:", process.env.B2_ENDPOINT);

    const testFilename = `test-${Date.now()}.txt`;
    const content = "Hello Backblaze B2 (Private) from HandScript!";
    const contentType = "text/plain";

    try {
        // 1. Upload
        console.log(`1. Uploading ${testFilename}...`);
        const key = await uploadFile('tests/' + testFilename, content, contentType);
        console.log(`   Uploaded Key: ${key}`);

        if (key.startsWith("http")) {
            console.warn("   ⚠️ Warning: uploadFile returned a URL, expected a Key.");
        }

        // 2. Generate Pre-signed URL
        console.log("2. Generating Pre-signed URL...");
        const signedUrl = await getDownloadUrl(key);
        console.log(`   Signed URL: ${signedUrl}`);

        // 3. Verify Access
        console.log("3. Verifying Access via Signed URL...");
        const response = await fetch(signedUrl);
        if (response.status === 200) {
            const text = await response.text();
            if (text === content) {
                console.log("   ✅ Success: Content matches.");
            } else {
                throw new Error("Content mismatch");
            }
        } else {
            console.error(`   ❌ Failed to fetch: ${response.status} ${response.statusText}`);
            throw new Error("Failed to fetch via signed URL");
        }

        // 4. List (Optional check)
        console.log("4. Listing files...");
        const result = await listFiles({ limit: 100 });
        const found = result.blobs.find(b => b.pathname === key);
        if (found) {
            console.log("   ✅ File found in list.");
        } else {
            console.warn("   ⚠️ File NOT found in list (eventually consistent?).");
        }

        // 5. Delete
        console.log("5. Deleting file...");
        await deleteFile(key);
        console.log("   Delete command sent.");

        // 6. Verify Delete
        console.log("6. Verifying deletion...");
        // Wait a bit for consistency
        await new Promise(r => setTimeout(r, 1000));
        const resultAfter = await listFiles({ limit: 100 });
        const foundAfter = resultAfter.blobs.find(b => b.pathname === key);

        if (!foundAfter) {
            console.log("   ✅ File successfully deleted.");
        } else {
            console.error("   ❌ File still exists.");
            throw new Error("File wasn't deleted");
        }

        console.log("SUCCESS: Private B2 Integration Works.");

    } catch (error) {
        console.error("TEST FAILED:", error);
        process.exit(1);
    }
}

main();

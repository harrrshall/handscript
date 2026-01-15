import { BatchResponseSchema, ContentBlockSchema } from '../lib/schema';
import { z } from 'zod';
import assert from 'assert';

console.log("Running Schema Tests...");

// Test valid batch response
const validResponse = {
    metadata: { title: "Test", subject: "Math", documentType: "lecture" },
    pages: [{ pageIndex: 0, content: [{ type: "paragraph", text: "Hello" }] }]
};

const parsed = BatchResponseSchema.safeParse(validResponse);
assert.ok(parsed.success, "Valid response should parse");
console.log("✔ Valid batch response parses correctly");

// Test invalid content block
const invalidBlock = { type: "unknown", data: "test" };
const result = ContentBlockSchema.safeParse(invalidBlock);
assert.ok(!result.success, "Invalid block should fail");
console.log("✔ Invalid content block rejected");

console.log("All schema tests passed!");

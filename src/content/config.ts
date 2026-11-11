import { defineCollection } from 'astro:content';
import { blogSchema, pageSchema, projectSchema, settingsSchema } from './schemas.mjs';

// Content collections for the git-tracked files in src/content. The schemas
// themselves live in schemas.mjs so the admin API and the build-time content
// source can share them.
const pages = defineCollection({ schema: pageSchema });
const projects = defineCollection({ schema: projectSchema });
const blog = defineCollection({ schema: blogSchema });
const settings = defineCollection({ type: 'data', schema: settingsSchema });

export const collections = { pages, projects, blog, settings };

import neo4j from "neo4j-driver";
import { env } from "../../config/env-schema.js";
// Create Neo4j driver instance
export const neo4jDriver = neo4j.driver(env.NEO4J_URI, neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD));

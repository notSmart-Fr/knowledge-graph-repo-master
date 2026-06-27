class Orchestrator {
    graphRetriever;
    constructor(graphRetriever) {
        this.graphRetriever = graphRetriever;
    }
    // Rule 17: Call graphRetriever.expandFromContact() without circuit breaker (violation!)
    async processContactIntent(contactId) {
        return this.graphRetriever.expandFromContact(contactId);
    }
}
export {};

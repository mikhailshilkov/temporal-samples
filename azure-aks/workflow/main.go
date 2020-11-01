package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/temporalio/samples-go/helloworld"
)

var c client.Client

func ping(w http.ResponseWriter, req *http.Request) {
	fmt.Fprintf(w, "pong")
}

func start(w http.ResponseWriter, r *http.Request, wait bool) {
	query := r.URL.Query()
	name := query.Get("name")
	if name == "" {
		name = "Guest"
	}
	log.Printf("Received request for %s\n", name)

	workflowOptions := client.StartWorkflowOptions{
		ID:        name,
		TaskQueue: "hello-world",
	}

	we, err := c.ExecuteWorkflow(context.Background(), workflowOptions, "Workflow", name)
	if err != nil {
		log.Fatalln("Unable to execute workflow", err)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Unable to execute workflow"))
		return
	}

	log.Println("Started workflow", "WorkflowID", we.GetID(), "RunID", we.GetRunID())

	if wait {
		// Synchronously wait for the workflow completion.
		var result string
		err = we.Get(context.Background(), &result)
		if err != nil {
			log.Fatalln("Unable to get workflow result", err)
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("500 - Unable to get workflow result"))
			return
		}
		log.Println("Workflow result:", result)

		w.Write([]byte(result))
	} else {
		w.WriteHeader(http.StatusAccepted)
		result := fmt.Sprintf("Started workflow ID=%s, RunID=%s", we.GetID(), we.GetRunID())
		w.Write([]byte(result))
	}
}

func sync(w http.ResponseWriter, r *http.Request) {
	start(w, r, true)
}

func async(w http.ResponseWriter, r *http.Request) {
	start(w, r, false)
}

func main() {
	http.HandleFunc("/ping", ping)
	http.HandleFunc("/sync", sync)
	http.HandleFunc("/async", async)

	// Start Server
	go func() {
		log.Println("Starting Web Server")
		http.ListenAndServe(":8080", nil)
	}()

	// The client and worker are heavyweight objects that should be created once per process.
	var err error
	c, err = client.NewClient(client.Options{HostPort: os.Getenv("TEMPORAL_GRPC_ENDPOINT")})
	if err != nil {
		log.Fatalln("Unable to create client", err)
	}
	defer c.Close()

	w := worker.New(c, "hello-world", worker.Options{})

	w.RegisterWorkflow(helloworld.Workflow)
	w.RegisterActivity(helloworld.Activity)

	err = w.Run(worker.InterruptCh())
	if err != nil {
		log.Fatalln("Unable to start worker", err)
	}
}

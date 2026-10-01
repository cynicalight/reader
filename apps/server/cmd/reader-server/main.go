package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"reader.local/server/internal/reader"
	"syscall"
	"time"
)

func main() {
	data := flag.String("data", ".reader", "local library directory")
	port := flag.String("port", "17840", "loopback port, 0 for automatic")
	web := flag.String("web", "", "built web directory")
	flag.Parse()
	root, err := filepath.Abs(*data)
	if err != nil {
		log.Fatal(err)
	}
	store, err := reader.OpenStore(root)
	if err != nil {
		log.Fatal(err)
	}
	defer store.DB.Close()
	token := os.Getenv("READER_TOKEN")
	if token == "" {
		b := make([]byte, 32)
		if _, err = rand.Read(b); err != nil {
			log.Fatal(err)
		}
		token = hex.EncodeToString(b)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+*port)
	if err != nil {
		log.Fatal(err)
	}
	server := reader.NewServer(store, token, *web)
	httpServer := &http.Server{Handler: server.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	ready, _ := json.Marshal(map[string]string{"url": "http://" + listener.Addr().String(), "token": token})
	fmt.Println(string(ready))
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(ctx)
	}()
	if err = httpServer.Serve(listener); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

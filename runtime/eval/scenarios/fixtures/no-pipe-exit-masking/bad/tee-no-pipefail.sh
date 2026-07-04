#!/bin/bash
npm test | tee /tmp/test.log | tail -5
